import { MediaLibraryError } from './errors.js'

export interface ConversionJob {
  mediaId: string
  conversionNames: string[]
}

export type ConversionProcessor = (job: ConversionJob) => Promise<void>

export interface QueueDriver {
  enqueue(job: ConversionJob): Promise<void>
  close(): Promise<void>
  /** @deprecated Use `attach` (in-process) or `work` (broker). Removed in Task 4. */
  registerProcessor?(fn: ConversionProcessor): void
}

/**
 * Consumes in the same process that produces. Core attaches its processor at
 * construction — there is no separate worker process.
 */
export interface InProcessQueueDriver extends QueueDriver {
  attach(processor: ConversionProcessor): void
}

/**
 * Backed by an external broker. Consuming requires an explicit
 * `MediaLibrary.startWorker()` in a dedicated process.
 */
export interface BrokerQueueDriver extends QueueDriver {
  work(processor: ConversionProcessor, opts?: WorkOptions): Promise<QueueWorker>
}

export interface QueueWorker {
  /** Stops consuming. Waits for in-flight jobs to settle unless `force`. */
  close(opts?: { force?: boolean }): Promise<void>
}

export interface WorkOptions {
  /** Max jobs processed concurrently. Driver default applies if omitted. */
  concurrency?: number
}

/** Any driver core accepts as configuration. */
export type AnyQueueDriver = InProcessQueueDriver | BrokerQueueDriver

/**
 * Synchronous in-process driver: `enqueue` awaits the processor inline, so
 * processor errors propagate directly to the `enqueue` caller.
 */
export function syncDriver(): InProcessQueueDriver {
  let processor: ConversionProcessor | undefined
  let closed = false

  const driver: InProcessQueueDriver = {
    async enqueue(job) {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      if (!processor) {
        throw new MediaLibraryError('no processor registered')
      }
      await processor(job)
    },

    attach(fn) {
      processor = fn
    },

    async close() {
      closed = true
    },
  }

  driver.registerProcessor = driver.attach
  return driver
}

/**
 * Deferred in-process driver: `enqueue` resolves immediately and the processor
 * runs on a later tick via `setImmediate`. Processor errors are caught and
 * logged (never surfaced as unhandled rejections) — the engine is responsible
 * for emitting `conversion:failed` itself.
 *
 * `close()` waits for every already-scheduled callback to settle before
 * resolving, so a caller that awaits it observes no further processor side
 * effects.
 */
export function deferDriver(): InProcessQueueDriver {
  let processor: ConversionProcessor | undefined
  let closed = false
  const pending = new Set<Promise<void>>()

  const driver: InProcessQueueDriver = {
    async enqueue(job) {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      if (!processor) {
        throw new MediaLibraryError('no processor registered')
      }
      const currentProcessor = processor
      const settled = new Promise<void>((resolve) => {
        setImmediate(() => {
          Promise.resolve()
            .then(() => currentProcessor(job))
            .catch((err) => {
              console.error('Error processing conversion job:', err)
            })
            .finally(resolve)
        })
      })
      pending.add(settled)
      void settled.finally(() => pending.delete(settled))
    },

    attach(fn) {
      processor = fn
    },

    async close() {
      closed = true
      await Promise.all([...pending])
    },
  }

  driver.registerProcessor = driver.attach
  return driver
}
