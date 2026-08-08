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

  let queue: Queue<ConversionJob> | undefined
  const workers = new Set<Worker<ConversionJob>>()
  let closed = false

  function getQueue(): Queue<ConversionJob> {
    if (!queue) {
      queue = new Queue<ConversionJob>(queueName, { connection })
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
      if (closed) return
      closed = true
      await Promise.all([...workers].map((w) => w.close()))
      workers.clear()
      await queue?.close()
    },
  }
}
