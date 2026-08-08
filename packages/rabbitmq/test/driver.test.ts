import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import type amqp from 'amqplib'
import type { ConversionJob } from '@node-media-library/core'
import { runBrokerQueueDriverContract } from '@node-media-library/core/testing'
import { rabbitmqDriver } from '../src/driver.js'

const hasAmqp = !!process.env.AMQP_URL
if (!hasAmqp) console.warn('[rabbitmq tests] AMQP_URL not set — driver contract suite skipped')

describe.skipIf(!hasAmqp)('rabbitmqDriver contract (requires AMQP_URL)', () => {
  runBrokerQueueDriverContract(
    'rabbitmqDriver',
    async () => rabbitmqDriver({ url: process.env.AMQP_URL!, queueName: `mlq-${randomUUID()}` }),
    { waitForAsync: () => new Promise((r) => setTimeout(r, 500)) },
  )
})

describe.skipIf(!hasAmqp)('driver.close() with an in-flight job (requires AMQP_URL)', () => {
  it('drains the in-flight job instead of racing its ack against channel teardown', async () => {
    const driver = rabbitmqDriver({ url: process.env.AMQP_URL!, queueName: `mlq-${randomUUID()}` })
    const unhandledRejections: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason)
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      let notifyStarted!: () => void
      const started = new Promise<void>((resolve) => {
        notifyStarted = resolve
      })
      let finished = false

      // The worker is deliberately left open — driver.close() below must
      // close it itself, mid-job, rather than requiring worker.close() to
      // be called first.
      await driver.work(async () => {
        notifyStarted()
        // Long enough that driver.close() is guaranteed to be called while
        // this job is still in flight, not after it has already settled.
        await new Promise((r) => setTimeout(r, 300))
        finished = true
      })

      await driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] })
      await started

      // Previously: closing the driver while a job was in flight closed the
      // channel out from under it, so the job's later ack() threw
      // IllegalOperationError, the resulting nack() in the catch block threw
      // for the same reason, and that second throw escaped as an unhandled
      // rejection (crashing the process under strict handling).
      await expect(driver.close()).resolves.toBeUndefined()

      expect(finished).toBe(true)
      // Give any rejection that would otherwise have gone unhandled a tick
      // to surface before asserting none did.
      await new Promise((r) => setTimeout(r, 50))
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })
})

it('constructs without connecting', () => {
  expect(typeof rabbitmqDriver({ url: 'amqp://127.0.0.1:1' }).enqueue).toBe('function')
})

it('rejects options with neither url nor connection', () => {
  // @ts-expect-error deliberately invalid options
  expect(() => rabbitmqDriver({})).toThrow(/url.*connection/i)
})

it('work() after close() rejects without connecting', async () => {
  const d = rabbitmqDriver({ url: 'amqp://127.0.0.1:1' })
  await d.close()
  await expect(d.work(async () => {})).rejects.toThrow('queue driver is closed')
})

it('does not close a caller-supplied connection', async () => {
  let connectionClosed = false
  const d = rabbitmqDriver({
    connection: {
      createChannel: async () => {
        throw new Error('not used in this test')
      },
      close: async () => {
        connectionClosed = true
      },
    },
  })
  await d.close()
  expect(connectionClosed).toBe(false)
})

/**
 * A caller-owned `AmqpLikeConnection` backed by a hand-rolled channel. These
 * cases are about this driver's own teardown bookkeeping — how many times it
 * cancels/closes a channel, whether a rejected in-flight settle escapes,
 * whether a failed consumer setup leaks a channel — and a real broker can
 * neither be made to produce those states on demand nor report the counts.
 * The behaviors these guard are all ungated so CI runs them without RabbitMQ.
 */
function fakeAmqp(hooks: { onAssertQueue?: () => Promise<void>; onSettle?: () => void } = {}) {
  const calls = { assertQueue: 0, cancel: 0, close: 0 }
  let deliver: ((msg: { content: Buffer }) => void) | undefined
  const channel = {
    async assertQueue() {
      calls.assertQueue++
      await hooks.onAssertQueue?.()
    },
    async prefetch() {},
    async consume(_queue: string, onMessage: (msg: { content: Buffer }) => void) {
      deliver = onMessage
      return { consumerTag: 'ct-1' }
    },
    async cancel() {
      calls.cancel++
    },
    async close() {
      calls.close++
    },
    ack() {
      hooks.onSettle?.()
    },
    nack() {
      hooks.onSettle?.()
    },
  }
  return {
    connection: {
      createChannel: async () => channel as unknown as amqp.Channel,
      close: async () => {},
    },
    calls,
    deliverJob: (job: ConversionJob) => deliver!({ content: Buffer.from(JSON.stringify(job)) }),
  }
}

describe('teardown bookkeeping', () => {
  it('worker.close() resolves even when a job’s ack and its fallback nack both throw', async () => {
    const f = fakeAmqp({
      onSettle: () => {
        throw new Error('IllegalOperationError: Channel closed')
      },
    })
    const d = rabbitmqDriver({ connection: f.connection })
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const w = await d.work(async () => gate)
    f.deliverJob({ mediaId: 'm1', conversionNames: ['thumb'] })
    release()
    // The in-flight settle rejects (ack throws, then the nack in its catch
    // throws too). Draining with Promise.all would propagate that into
    // worker.close(), driver.close(), and a CLI exit code of 1 — on a
    // shutdown that otherwise succeeded.
    await expect(w.close()).resolves.toBeUndefined()
    await expect(d.close()).resolves.toBeUndefined()
  })

  it('concurrent worker.close() and driver.close() cancel and close the channel once', async () => {
    const f = fakeAmqp()
    const d = rabbitmqDriver({ connection: f.connection })
    const w = await d.work(async () => {})
    await Promise.all([w.close(), w.close(), d.close()])
    expect(f.calls.cancel).toBe(1)
    expect(f.calls.close).toBe(1)
  })

  it('a concurrent second driver.close() does not resolve before the first drain finishes', async () => {
    const f = fakeAmqp()
    const d = rabbitmqDriver({ connection: f.connection })
    let finished = false
    await d.work(async () => {
      await new Promise((r) => setTimeout(r, 50))
      finished = true
    })
    f.deliverJob({ mediaId: 'm1', conversionNames: ['thumb'] })
    const first = d.close()
    const second = d.close()
    // A bare `if (closed) return` would let this one resolve immediately,
    // handing the caller a "closed" driver whose drain is still running.
    await second
    expect(finished).toBe(true)
    await first
  })

  it('closes the consumer channel when consumer setup fails', async () => {
    const f = fakeAmqp({
      onAssertQueue: async () => {
        throw new Error('PRECONDITION_FAILED')
      },
    })
    const d = rabbitmqDriver({ connection: f.connection })
    await expect(d.work(async () => {})).rejects.toThrow('PRECONDITION_FAILED')
    // No QueueWorker was created, and driver.close() only reaches consumer
    // channels through the workers it created — so if work() didn't close
    // this channel itself, nothing ever would.
    expect(f.calls.close).toBe(1)
    await d.close()
  })

  it('worker.close({ force: true }) cuts short a graceful close that is still draining', async () => {
    const f = fakeAmqp()
    const d = rabbitmqDriver({ connection: f.connection })
    let finished = false
    const w = await d.work(async () => {
      await new Promise<void>(() => {}) // a wedged job: never settles
      finished = true
    })
    f.deliverJob({ mediaId: 'm1', conversionNames: ['thumb'] })
    const graceful = w.close()
    graceful.catch(() => {})
    // This is the escalation the `worker` CLI performs once
    // --shutdown-timeout elapses. Memoizing close() as a whole promise would
    // hand back the very drain we just timed out of, and hang forever.
    await w.close({ force: true })
    expect(finished).toBe(false)
    expect(f.calls.cancel).toBe(1)
    expect(f.calls.close).toBe(1)
  })
})

describe('exports', () => {
  it('exports rabbitmqDriver', async () => {
    const mod = await import('../src/index.js')
    expect(typeof mod.rabbitmqDriver).toBe('function')
  })
})
