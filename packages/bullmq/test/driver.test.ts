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

describe('exports', () => {
  it('exports bullmqDriver and BullmqDriverOptions', async () => {
    const mod = await import('../src/index.js')
    expect(mod.bullmqDriver).toBeDefined()
    expect(typeof mod.bullmqDriver).toBe('function')
  })
})
