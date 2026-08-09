import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { runBrokerQueueDriverContract } from '@node-media-library/core/testing'
import { bullmqDriver } from '../src/driver.js'

const hasRedis = !!process.env.REDIS_URL
if (!hasRedis) console.warn('[bullmq tests] REDIS_URL not set — driver contract suite skipped')

describe.skipIf(!hasRedis)('bullmqDriver contract (requires REDIS_URL)', () => {
  runBrokerQueueDriverContract(
    'bullmqDriver',
    async () =>
      bullmqDriver({
        connection: { url: process.env.REDIS_URL! },
        queueName: `mlq-${randomUUID()}`,
      }),
    { waitForAsync: () => new Promise((r) => setTimeout(r, 500)) },
  )
})

it('constructs without touching redis', () => {
  expect(typeof bullmqDriver({ connection: { host: 'localhost' } }).enqueue).toBe('function')
})

it('work() after close() rejects without touching redis', async () => {
  const d = bullmqDriver({ connection: { host: 'localhost' } })
  await d.close()
  await expect(d.work(async () => {})).rejects.toThrow('queue driver is closed')
})

it('an unreachable broker reports through onError instead of crashing the process', async () => {
  // `Queue`/`Worker` are Node `EventEmitter`s, and Node throws on an
  // unhandled 'error' event — an uncaught exception, not a rejection. If the
  // driver didn't attach a listener, ioredis's connection failure below would
  // crash this test process outright rather than surfacing as a call to
  // `onError`.
  const errors: Error[] = []
  const d = bullmqDriver({
    connection: {
      host: '127.0.0.1',
      port: 1, // nothing listens here
      retryStrategy: () => null, // fail once instead of retrying forever
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    },
    onError: (err) => errors.push(err),
  })
  const uncaught: unknown[] = []
  const onUncaught = (err: unknown) => uncaught.push(err)
  process.on('uncaughtException', onUncaught)
  try {
    // The connection failure surfaces asynchronously via the Queue's 'error'
    // event; enqueue() itself may resolve, reject, or hang depending on
    // ioredis's internal retry bookkeeping, so it isn't awaited/asserted on
    // — the connection attempt it triggers is what matters here.
    void d.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] }).catch(() => {})
    await new Promise((r) => setTimeout(r, 500))
    expect(errors.length).toBeGreaterThan(0)
    expect(uncaught).toEqual([])
  } finally {
    process.off('uncaughtException', onUncaught)
    await d.close().catch(() => {})
  }
})

describe('exports', () => {
  it('exports bullmqDriver and BullmqDriverOptions', async () => {
    const mod = await import('../src/index.js')
    expect(mod.bullmqDriver).toBeDefined()
    expect(typeof mod.bullmqDriver).toBe('function')
  })
})
