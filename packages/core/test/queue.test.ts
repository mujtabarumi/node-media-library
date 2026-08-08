import { it, expect, vi } from 'vitest'
import { runInProcessQueueDriverContract } from '../src/testing/queue-contract.js'
import { syncDriver, deferDriver } from '../src/queue.js'

runInProcessQueueDriverContract('syncDriver', async () => syncDriver())
runInProcessQueueDriverContract('deferDriver', async () => deferDriver(), {
  waitForAsync: () => new Promise((r) => setImmediate(r)),
})

it('syncDriver propagates processor errors to enqueue', async () => {
  const d = syncDriver()
  d.attach(async () => {
    throw new Error('boom')
  })
  await expect(d.enqueue({ mediaId: 'm', conversionNames: ['t'] })).rejects.toThrow('boom')
})

it('deferDriver swallows processor errors after logging', async () => {
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
  const d = deferDriver()
  d.attach(async () => {
    throw new Error('boom')
  })
  await d.enqueue({ mediaId: 'm', conversionNames: ['t'] })
  await new Promise((r) => setImmediate(r))
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})

it('deferDriver.close() drains scheduled jobs before resolving', async () => {
  const seen: string[] = []
  const d = deferDriver()
  d.attach(async (job) => {
    await new Promise((r) => setTimeout(r, 20))
    seen.push(job.mediaId)
  })
  await d.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] })
  await d.enqueue({ mediaId: 'm2', conversionNames: ['thumb'] })
  await d.close()
  expect(seen.sort()).toEqual(['m1', 'm2'])
})

it('deferDriver.close() still resolves when a job rejects', async () => {
  const d = deferDriver()
  d.attach(async () => {
    throw new Error('boom')
  })
  await d.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] })
  await expect(d.close()).resolves.toBeUndefined()
})

it('syncDriver exposes attach', async () => {
  const seen: string[] = []
  const d = syncDriver()
  d.attach(async (job) => {
    seen.push(job.mediaId)
  })
  await d.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] })
  expect(seen).toEqual(['m1'])
})
