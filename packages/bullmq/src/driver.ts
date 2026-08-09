import { Queue, Worker } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'
import {
  MediaLibraryError,
  type BrokerQueueDriver,
  type ConversionJob,
  type ConversionProcessor,
  type QueueWorker,
  type WorkOptions,
} from '@node-media-library/core'

const DEFAULT_QUEUE_NAME = 'media-conversions'
const DEFAULT_WORKER_CONCURRENCY = 2

export interface BullmqDriverOptions {
  /** ioredis-compatible connection options or instance; passed through to BullMQ. */
  connection: unknown
  /** @defaultValue 'media-conversions' */
  queueName?: string
  /** Default concurrency, overridden per-call by `WorkOptions.concurrency`. @defaultValue 2 */
  workerConcurrency?: number
  /**
   * Called whenever the underlying `Queue` or a `Worker` emits an `'error'`
   * event — a Redis disconnect, a dropped connection, a failed command. Both
   * are Node `EventEmitter`s, and Node throws on an unhandled `'error'`
   * event, so this driver always attaches a listener; omitting this option
   * does not mean errors go unhandled, only that they are reported with
   * `console.error` instead of your own logger. Pass your own to log through
   * your own logger, alert, or exit deliberately (e.g. under a supervisor
   * that restarts the process). @defaultValue logs via `console.error`
   */
  onError?: (err: Error) => void
}

/**
 * BullMQ-backed broker driver. The `Queue` is created lazily on first
 * `enqueue`, and a `Worker` only ever on an explicit `work()` call — so
 * constructing the driver, or holding one in a web process, never consumes.
 */
export function bullmqDriver(opts: BullmqDriverOptions): BrokerQueueDriver {
  const connection = opts.connection as ConnectionOptions
  const queueName = opts.queueName ?? DEFAULT_QUEUE_NAME
  const defaultConcurrency = opts.workerConcurrency ?? DEFAULT_WORKER_CONCURRENCY
  const onError =
    opts.onError ?? ((err: Error) => console.error('[bullmqDriver] broker error:', err))

  let queue: Queue<ConversionJob> | undefined
  const workers = new Set<Worker<ConversionJob>>()
  let closed = false
  let driverClosing: Promise<void> | undefined

  function getQueue(): Queue<ConversionJob> {
    if (!queue) {
      queue = new Queue<ConversionJob>(queueName, { connection })
      // Queue is an EventEmitter; Node throws on an unhandled 'error' event
      // (a Redis disconnect, a failed command), which would otherwise crash
      // the process instead of surfacing as a rejected call.
      queue.on('error', onError)
    }
    return queue
  }

  return {
    async enqueue(job: ConversionJob) {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      await getQueue().add('convert', job)
    },

    async work(fn: ConversionProcessor, workOpts?: WorkOptions): Promise<QueueWorker> {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      const worker = new Worker<ConversionJob>(queueName, async (j) => fn(j.data), {
        connection,
        concurrency: workOpts?.concurrency ?? defaultConcurrency,
      })
      // Worker is an EventEmitter too — same unhandled-'error'-crashes-the-
      // process hazard as the Queue above.
      worker.on('error', onError)
      workers.add(worker)
      await worker.waitUntilReady()

      return {
        async close(closeOpts?: { force?: boolean }) {
          workers.delete(worker)
          // BullMQ's close(force) skips waiting for active jobs.
          await worker.close(closeOpts?.force ?? false)
        },
      }
    },

    async close() {
      closed = true
      // Memoized rather than `if (closed) return`: that early return let a
      // concurrent second close() resolve while the first one was still
      // draining workers, so a caller awaiting it observed a "closed" driver
      // whose drain — and, on rejection, the `queue?.close()` below — hadn't
      // actually run yet. Every caller now awaits the same drain instead.
      driverClosing ??= (async () => {
        await Promise.all([...workers].map((w) => w.close()))
        workers.clear()
        await queue?.close()
      })()
      return driverClosing
    },
  }
}
