import { describe, it, expect, beforeEach } from 'vitest'
import { MediaLibraryError } from '../errors.js'
import type { ConversionJob, QueueDriver } from '../queue.js'

export function runQueueDriverContract(
  name: string,
  factory: () => Promise<QueueDriver>,
  opts?: {
    waitForAsync?: () => Promise<void>
    assertOrder?: boolean
    /**
     * Skip the "enqueuing without a registered processor rejects" test.
     * Broker-backed drivers (e.g. bullmq) legitimately accept jobs with no
     * local processor registered — the job simply waits on the broker for a
     * worker to pick it up.
     */
    skipNoProcessorRule?: boolean
  },
): void {
  const waitForAsync = opts?.waitForAsync ?? (() => Promise.resolve())
  const assertOrder = opts?.assertOrder ?? true
  const skipNoProcessorRule = opts?.skipNoProcessorRule ?? false

  describe(`QueueDriver contract: ${name}`, () => {
    let driver: QueueDriver

    beforeEach(async () => {
      driver = await factory()
    })

    it.skipIf(skipNoProcessorRule)(
      'enqueuing without a registered processor rejects with MediaLibraryError',
      async () => {
        await expect(
          driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] }),
        ).rejects.toThrow(MediaLibraryError)
        await expect(
          driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] }),
        ).rejects.toThrow('no processor registered')
      },
    )

    it('processor receives the exact job payload', async () => {
      const received: ConversionJob[] = []
      driver.registerProcessor(async (job) => {
        received.push(job)
      })
      const job: ConversionJob = { mediaId: 'm1', conversionNames: ['thumb', 'large'] }
      await driver.enqueue(job)
      await waitForAsync()
      expect(received).toEqual([job])
    })

    it('multiple enqueued jobs are all processed', async () => {
      const received: ConversionJob[] = []
      driver.registerProcessor(async (job) => {
        received.push(job)
      })
      const jobs: ConversionJob[] = [
        { mediaId: 'm1', conversionNames: ['thumb'] },
        { mediaId: 'm2', conversionNames: ['large'] },
        { mediaId: 'm3', conversionNames: ['thumb', 'large'] },
      ]
      for (const job of jobs) {
        await driver.enqueue(job)
      }
      await waitForAsync()
      expect(received).toHaveLength(3)
      if (assertOrder) {
        expect(received).toEqual(jobs)
      } else {
        const byMediaId = (a: ConversionJob, b: ConversionJob) => a.mediaId.localeCompare(b.mediaId)
        expect([...received].sort(byMediaId)).toEqual([...jobs].sort(byMediaId))
      }
    })

    it('later registerProcessor calls replace earlier ones', async () => {
      const first: ConversionJob[] = []
      const second: ConversionJob[] = []
      driver.registerProcessor(async (job) => {
        first.push(job)
      })
      driver.registerProcessor(async (job) => {
        second.push(job)
      })
      const job: ConversionJob = { mediaId: 'm1', conversionNames: ['thumb'] }
      await driver.enqueue(job)
      await waitForAsync()
      expect(second).toEqual([job])
      expect(first).toEqual([])
    })

    it('close() is idempotent', async () => {
      driver.registerProcessor(async () => {})
      await driver.close()
      await expect(driver.close()).resolves.toBeUndefined()
    })

    it('enqueue rejects after close()', async () => {
      driver.registerProcessor(async () => {})
      await driver.close()
      await expect(
        driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] }),
      ).rejects.toThrow()
    })
  })
}
