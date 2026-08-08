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
