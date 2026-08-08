import { describe, it, expect, afterEach } from 'vitest'
import { rm } from 'node:fs/promises'
import { createMediaLibrary, MediaLibraryError, syncDriver } from '../src/index.js'
import type { BrokerQueueDriver, ConversionProcessor, QueueWorker } from '../src/index.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'

const TMP_ROOT = './.tmp-queue-wiring'

/** The only members `MediaLibrary` may touch on a broker driver's `enqueue`/`work`/`close` surface. */
const ALLOWED_KEYS = new Set<string | symbol>(['attached', 'enqueue', 'work', 'close'])

/**
 * Wrapped in a `Proxy` whose `get` trap throws on anything outside
 * `ALLOWED_KEYS` — this is what gives the "does not consume at construction"
 * test teeth. The pre-fix constructor read `this.resolved.queue.registerProcessor?.(...)`,
 * an access to a property this fake deliberately doesn't allowlist; against a
 * plain object literal that call is silently a no-op (`?.()` on `undefined`),
 * so a plain fake can't tell the old, broken constructor apart from the
 * fixed one. The `in` operator (`'attach' in driver`, `'work' in driver`)
 * goes through the `has` trap, not `get` — confirmed empirically — so it's
 * intentionally left untrapped (default forwarding) and never trips this
 * guard. Symbol-keyed access is always allowed since it's Node/vitest
 * housekeeping (e.g. `Symbol.toPrimitive`, `util.inspect.custom`, thenable
 * probes), not queue driver consumption.
 */
function fakeBroker(): BrokerQueueDriver & { attached: ConversionProcessor[] } {
  const attached: ConversionProcessor[] = []
  const target = {
    attached,
    async enqueue() {},
    async work(fn: ConversionProcessor): Promise<QueueWorker> {
      attached.push(fn)
      return { async close() {} }
    },
    async close() {},
  }
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === 'symbol' || ALLOWED_KEYS.has(prop)) {
        return Reflect.get(obj, prop, receiver)
      }
      throw new Error(
        `queue-wiring test: unexpected property access "${String(prop)}" on the broker driver — ` +
          `MediaLibrary must not touch anything outside enqueue/work/close at construction`,
      )
    },
  })
}

function makeLibrary(queue: Parameters<typeof createMediaLibrary>[0]['queue']) {
  return createMediaLibrary({
    repository: new InMemoryMediaRepository(),
    storage: { disks: { default: { driver: 'fs', root: TMP_ROOT } } },
    models: { User: {} },
    queue,
  })
}

afterEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true })
})

describe('queue wiring', () => {
  it('does not consume from a broker driver at construction', () => {
    const broker = fakeBroker()
    makeLibrary(broker)
    expect(broker.attached).toEqual([])
  })

  it('startWorker() attaches the engine processor to a broker driver', async () => {
    const broker = fakeBroker()
    const library = makeLibrary(broker)
    const worker = await library.startWorker({ concurrency: 3 })
    expect(broker.attached).toHaveLength(1)
    await expect(worker.close()).resolves.toBeUndefined()
  })

  it('startWorker() on an in-process driver throws a clear error', async () => {
    const library = makeLibrary(syncDriver())
    await expect(library.startWorker()).rejects.toThrow(/in-process/)
  })

  it('rejects a driver implementing both attach() and work()', () => {
    const attached: ConversionProcessor[] = []
    // The shape the union type admits but the split exists to forbid: an
    // in-house wrapper with an inline fallback *and* a broker mode. Without
    // the guard the constructor attaches (consuming inline in this process)
    // while startWorker() would also succeed, consuming from the broker too.
    const hybrid = {
      attach(fn: ConversionProcessor) {
        attached.push(fn)
      },
      async enqueue() {},
      async work(fn: ConversionProcessor): Promise<QueueWorker> {
        attached.push(fn)
        return { async close() {} }
      },
      async close() {},
    }
    expect(() => makeLibrary(hybrid)).toThrow(MediaLibraryError)
    expect(() => makeLibrary(hybrid)).toThrow(/both attach\(\) and work\(\)/)
    // The guard runs before the attach, so the bad driver is never wired.
    expect(attached).toEqual([])
  })

  it('close() closes the configured driver', async () => {
    let closed = false
    const broker = fakeBroker()
    broker.close = async () => {
      closed = true
    }
    await makeLibrary(broker).close()
    expect(closed).toBe(true)
  })
})
