import { MediaLibraryError } from './errors.js'

export interface ConversionJob {
  mediaId: string
  conversionNames: string[]
}

export type ConversionProcessor = (job: ConversionJob) => Promise<void>

export interface QueueDriver {
  enqueue(job: ConversionJob): Promise<void>
  registerProcessor(fn: ConversionProcessor): void
  close(): Promise<void>
}

/**
 * Synchronous queue driver: `enqueue` awaits the processor inline, so
 * processor errors propagate directly to the `enqueue` caller.
 */
export function syncDriver(): QueueDriver {
  let processor: ConversionProcessor | undefined
  let closed = false

  return {
    async enqueue(job) {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      if (!processor) {
        throw new MediaLibraryError('no processor registered')
      }
      await processor(job)
    },

    registerProcessor(fn) {
      processor = fn
    },

    async close() {
      closed = true
    },
  }
}

/**
 * Deferred queue driver: `enqueue` resolves immediately and the processor
 * runs on a later tick via `setImmediate`. Processor errors are caught and
 * logged (never surfaced as unhandled rejections) — the engine is
 * responsible for emitting `conversion:failed` itself.
 * @internal
 */
export function deferDriver(): QueueDriver {
  let processor: ConversionProcessor | undefined
  let closed = false

  return {
    async enqueue(job) {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      if (!processor) {
        throw new MediaLibraryError('no processor registered')
      }
      const currentProcessor = processor
      setImmediate(() => {
        Promise.resolve()
          .then(() => currentProcessor(job))
          .catch((err) => {
            console.error('Error processing conversion job:', err)
          })
      })
    },

    registerProcessor(fn) {
      processor = fn
    },

    // Honesty note: close() only flips `closed` (so future enqueue() calls
    // reject) — it does not wait for, or cancel, setImmediate callbacks
    // already scheduled by prior enqueue() calls. Those still fire on a
    // later tick and still run the processor; a caller that awaits close()
    // expecting all in-flight work to have stopped will observe processor
    // side effects (or the console.error from a rejected processor) after
    // close() has already resolved.
    async close() {
      closed = true
    },
  }
}
