import { describe, it, expect, afterEach } from 'vitest'
import { rm } from 'node:fs/promises'
import { createMediaLibrary, MediaLibraryError, syncDriver } from '../src/index.js'
import type { BrokerQueueDriver, ConversionProcessor, QueueWorker } from '../src/index.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'

const TMP_ROOT = './.tmp-queue-wiring'

/**
 * The only members `MediaLibrary` may touch on a broker driver's
 * `enqueue`/`work`/`close` surface. `attach` is allowlisted as a *read*: the
 * driver discriminator probes `typeof driver.attach === 'function'`, so reading
 * the (absent) property is expected — calling it never is, and this fake has no
 * `attach` to call.
 */
const ALLOWED_KEYS = new Set<string | symbol>(['attached', 'attach', 'enqueue', 'work', 'close'])

/**
 * Wrapped in a `Proxy` whose `get` trap throws on anything outside
 * `ALLOWED_KEYS` — this is what gives the "does not consume at construction"
 * test teeth. The pre-fix constructor read `this.resolved.queue.registerProcessor?.(...)`,
 * an access to a property this fake deliberately doesn't allowlist; against a
 * plain object literal that call is silently a no-op (`?.()` on `undefined`),
 * so a plain fake can't tell the old, broken constructor apart from the
 * fixed one. The discriminator's own `typeof driver.attach`/`typeof
 * driver.work` reads DO go through this trap, which is why both names are
 * allowlisted. Symbol-keyed access is always allowed since it's Node/vitest
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

  it('treats a driver whose attach is undefined as broker-backed, not hybrid', async () => {
    // `attach: undefined` satisfies `'attach' in driver` — an optional
    // property, an object spread, or a declared-but-unassigned class field all
    // produce it. Under the old `in` discriminator this tripped the
    // hybrid-driver guard at construction; with `typeof === 'function'` it is
    // correctly just a broker driver.
    const attached: ConversionProcessor[] = []
    const driver = {
      attach: undefined,
      async enqueue() {},
      async work(fn: ConversionProcessor): Promise<QueueWorker> {
        attached.push(fn)
        return { async close() {} }
      },
      async close() {},
    } as unknown as BrokerQueueDriver
    const library = makeLibrary(driver)
    await library.startWorker()
    expect(attached).toHaveLength(1)
  })

  it('does not call an attach that is present but not callable', () => {
    // The other half of the same bug: `in` would have reached `attach(...)`
    // and thrown a raw TypeError instead of leaving the driver alone.
    const driver = {
      attach: 'not a function',
      async enqueue() {},
      async close() {},
    } as unknown as BrokerQueueDriver
    expect(() => makeLibrary(driver)).not.toThrow()
  })

  it('startWorker() on a driver with neither attach() nor work() says so accurately', async () => {
    const driver = { async enqueue() {}, async close() {} } as unknown as BrokerQueueDriver
    const library = makeLibrary(driver)
    // It is emphatically NOT in-process — telling an operator that would send
    // them looking for inline conversions that never run.
    await expect(library.startWorker()).rejects.toThrow(/neither work\(\) nor attach\(\)/)
    await expect(library.startWorker()).rejects.not.toThrow(/is in-process/)
  })

  describe('broker job payload validation', () => {
    /** The processor `startWorker()` handed the driver — i.e. what a broker message reaches. */
    async function processorFor(): Promise<ConversionProcessor> {
      const broker = fakeBroker()
      const library = makeLibrary(broker)
      await library.startWorker()
      return broker.attached[0]!
    }

    it.each([
      ['a non-object payload', 'not a job', /expected an object/],
      ['a null payload', null, /expected an object/],
      ['a missing mediaId', { conversionNames: ['thumb'] }, /"mediaId" must be a string/],
      ['a numeric mediaId', { mediaId: 42 }, /"mediaId" must be a string/],
      [
        'a non-array conversionNames',
        { mediaId: 'med_01', conversionNames: 'thumb' },
        /"conversionNames" must be absent or an array of strings/,
      ],
      [
        'a conversionNames holding a non-string',
        { mediaId: 'med_01', conversionNames: ['thumb', 7] },
        /"conversionNames" must be absent or an array of strings/,
      ],
    ])('rejects %s with a MediaLibraryError', async (_label, payload, message) => {
      const processor = await processorFor()
      // Drivers deserialize broker bytes and cast (`as ConversionJob`), so
      // anything publishable to the queue can arrive here. A rejection is what
      // routes the job to the driver's nack/dead-letter path.
      await expect(processor(payload as never)).rejects.toThrow(MediaLibraryError)
      await expect(processor(payload as never)).rejects.toThrow(message)
    })

    it('accepts a well-formed payload with conversionNames omitted', async () => {
      const processor = await processorFor()
      // Passes the guard and reaches the engine, which no-ops for an unknown
      // id — the point is that the omitted `conversionNames` is not itself
      // rejected, since a driver may legitimately deliver a job without it.
      await expect(processor({ mediaId: 'missing' } as never)).resolves.toBeUndefined()
    })

    it('accepts a well-formed payload with conversionNames present', async () => {
      const processor = await processorFor()
      await expect(
        processor({ mediaId: 'missing', conversionNames: ['thumb'] } as never),
      ).resolves.toBeUndefined()
    })
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
