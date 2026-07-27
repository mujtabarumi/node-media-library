import { it, expect, vi } from 'vitest'
import { runQueueDriverContract } from '../src/testing/queue-contract.js'
import { syncDriver, deferDriver } from '../src/queue.js'

runQueueDriverContract('syncDriver', async () => syncDriver())
runQueueDriverContract('deferDriver', async () => deferDriver(), {
  waitForAsync: () => new Promise((r) => setImmediate(r)),
  assertOrder: false,
})

it('syncDriver propagates processor errors to enqueue', async () => {
  const d = syncDriver()
  d.registerProcessor(async () => {
    throw new Error('boom')
  })
  await expect(d.enqueue({ mediaId: 'm', conversionNames: ['t'] })).rejects.toThrow('boom')
})

it('deferDriver swallows processor errors after logging', async () => {
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
  const d = deferDriver()
  d.registerProcessor(async () => {
    throw new Error('boom')
  })
  await d.enqueue({ mediaId: 'm', conversionNames: ['t'] })
  await new Promise((r) => setImmediate(r))
  expect(warn).toHaveBeenCalled()
  warn.mockRestore()
})
