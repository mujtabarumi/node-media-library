import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
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

describe('exports', () => {
  it('exports rabbitmqDriver', async () => {
    const mod = await import('../src/index.js')
    expect(typeof mod.rabbitmqDriver).toBe('function')
  })
})
