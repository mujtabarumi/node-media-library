import { Queue, Worker } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'
import {
  MediaLibraryError,
  type ConversionJob,
  type ConversionProcessor,
  type QueueDriver,
} from '@node-media-library/core'

const DEFAULT_QUEUE_NAME = 'media-conversions'
const DEFAULT_WORKER_CONCURRENCY = 2

export interface BullmqDriverOptions {
  /** ioredis-compatible connection options or instance; passed through to BullMQ. */
  connection: unknown
  /** @defaultValue 'media-conversions' */
  queueName?: string
  /** @defaultValue 2 */
  workerConcurrency?: number
}

/**
 * BullMQ-backed queue driver. `Queue` and `Worker` instances are created
 * lazily (on first `enqueue`/`registerProcessor` call) so constructing the
 * driver never touches Redis.
 */
export function bullmqDriver(opts: BullmqDriverOptions): QueueDriver {
  const connection = opts.connection as ConnectionOptions
  const queueName = opts.queueName ?? DEFAULT_QUEUE_NAME
  const workerConcurrency = opts.workerConcurrency ?? DEFAULT_WORKER_CONCURRENCY

  let queue: Queue<ConversionJob> | undefined
  let worker: Worker<ConversionJob> | undefined
  let closed = false
  // Bumped on every registerProcessor()/close() call so a superseded
  // in-flight worker-close → worker-create chain (see registerProcessor
  // below) can detect it's stale and bail out instead of racing.
  let generation = 0

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

    registerProcessor(fn: ConversionProcessor) {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      const myGeneration = ++generation
      const oldWorker = worker
      worker = undefined
      const createWorker = () => {
        // Superseded by a later registerProcessor()/close() — don't create
        // a worker nobody asked for anymore.
        if (closed || myGeneration !== generation) return
        worker = new Worker<ConversionJob>(queueName, async (j) => fn(j.data), {
          connection,
          concurrency: workerConcurrency,
        })
      }
      // Wait for the old worker to fully close before starting the new one,
      // so the two never process the same queue concurrently.
      if (oldWorker) {
        oldWorker.close().finally(createWorker)
      } else {
        createWorker()
      }
    },

    async close() {
      if (closed) return
      closed = true
      generation++
      await worker?.close()
      await queue?.close()
    },
  }
}
