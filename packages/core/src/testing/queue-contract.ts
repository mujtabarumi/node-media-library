import { describe, it, expect, beforeEach } from 'vitest'
import { MediaLibraryError } from '../errors.js'
import type { BrokerQueueDriver, ConversionJob, InProcessQueueDriver } from '../queue.js'

export function runInProcessQueueDriverContract(
  name: string,
  factory: () => Promise<InProcessQueueDriver>,
  opts?: { waitForAsync?: () => Promise<void>; assertOrder?: boolean },
): void {
  const waitForAsync = opts?.waitForAsync ?? (() => Promise.resolve())
  const assertOrder = opts?.assertOrder ?? true

  describe(`InProcessQueueDriver contract: ${name}`, () => {
    let driver: InProcessQueueDriver

    beforeEach(async () => {
      driver = await factory()
    })

    it('enqueuing without an attached processor rejects with MediaLibraryError', async () => {
      await expect(driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] })).rejects.toThrow(
        MediaLibraryError,
      )
      await expect(driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] })).rejects.toThrow(
        'no processor registered',
      )
    })

    it('processor receives the exact job payload', async () => {
      const received: ConversionJob[] = []
      driver.attach(async (job) => {
        received.push(job)
      })
      const job: ConversionJob = { mediaId: 'm1', conversionNames: ['thumb', 'large'] }
      await driver.enqueue(job)
      await waitForAsync()
      expect(received).toEqual([job])
    })

    it('multiple enqueued jobs are all processed', async () => {
      const received: ConversionJob[] = []
      driver.attach(async (job) => {
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

    it('later attach calls replace earlier ones', async () => {
      const first: ConversionJob[] = []
      const second: ConversionJob[] = []
      driver.attach(async (job) => {
        first.push(job)
      })
      driver.attach(async (job) => {
        second.push(job)
      })
      const job: ConversionJob = { mediaId: 'm1', conversionNames: ['thumb'] }
      await driver.enqueue(job)
      await waitForAsync()
      expect(second).toEqual([job])
      expect(first).toEqual([])
    })

    it('close() resolves only after already-enqueued work has settled', async () => {
      const done: string[] = []
      driver.attach(async (job) => {
        await new Promise((r) => setTimeout(r, 20))
        done.push(job.mediaId)
      })
      await driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] })
      await driver.close()
      // A caller that awaited close() must observe no further processor side
      // effects. A driver whose enqueue() is inherently synchronous satisfies
      // this trivially (the work is already done); a deferred one has to
      // actually drain what it scheduled.
      expect(done).toEqual(['m1'])
    })

    it('close() is idempotent', async () => {
      driver.attach(async () => {})
      await driver.close()
      await expect(driver.close()).resolves.toBeUndefined()
    })

    it('enqueue rejects after close()', async () => {
      driver.attach(async () => {})
      await driver.close()
      await expect(driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] })).rejects.toThrow()
    })
  })
}

/**
 * How long the drain/force-close cases keep a job in flight. Long enough that
 * `close()` is guaranteed to be called mid-job rather than after it settled,
 * short enough to stay well inside vitest's default timeout.
 */
const IN_FLIGHT_MS = 300

export function runBrokerQueueDriverContract(
  name: string,
  factory: () => Promise<BrokerQueueDriver>,
  opts?: { waitForAsync?: () => Promise<void> },
): void {
  const waitForAsync = opts?.waitForAsync ?? (() => Promise.resolve())

  describe(`BrokerQueueDriver contract: ${name}`, () => {
    let driver: BrokerQueueDriver

    beforeEach(async () => {
      driver = await factory()
    })

    it('accepts jobs with no worker running', async () => {
      await expect(
        driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] }),
      ).resolves.toBeUndefined()
      await driver.close()
    })

    it('a worker receives the exact job payload', async () => {
      const received: ConversionJob[] = []
      const worker = await driver.work(async (job) => {
        received.push(job)
      })
      const job: ConversionJob = { mediaId: 'm1', conversionNames: ['thumb', 'large'] }
      await driver.enqueue(job)
      await waitForAsync()
      await worker.close()
      await driver.close()
      expect(received).toEqual([job])
    })

    it('multiple enqueued jobs are all processed', async () => {
      const received: ConversionJob[] = []
      const worker = await driver.work(async (job) => {
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
      await worker.close()
      await driver.close()
      const byMediaId = (a: ConversionJob, b: ConversionJob) => a.mediaId.localeCompare(b.mediaId)
      expect([...received].sort(byMediaId)).toEqual([...jobs].sort(byMediaId))
    })

    it('worker.close() stops delivery', async () => {
      const received: ConversionJob[] = []
      const worker = await driver.work(async (job) => {
        received.push(job)
      })
      await worker.close()
      await driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] })
      await waitForAsync()
      await driver.close()
      expect(received).toEqual([])
    })

    it('worker.close() waits for an in-flight job to finish', async () => {
      let notifyStarted!: () => void
      const started = new Promise<void>((resolve) => {
        notifyStarted = resolve
      })
      let finished = false
      const worker = await driver.work(async () => {
        notifyStarted()
        await new Promise((r) => setTimeout(r, IN_FLIGHT_MS))
        finished = true
      })
      await driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] })
      await started
      // Sanity check that the job really is mid-flight — otherwise the
      // assertion after close() would pass for a driver that never drains.
      expect(finished).toBe(false)
      await worker.close()
      expect(finished).toBe(true)
      await driver.close()
    })

    it('worker.close({ force: true }) abandons an in-flight job', async () => {
      let notifyStarted!: () => void
      const started = new Promise<void>((resolve) => {
        notifyStarted = resolve
      })
      let finished = false
      const worker = await driver.work(async () => {
        notifyStarted()
        await new Promise((r) => setTimeout(r, IN_FLIGHT_MS))
        finished = true
      })
      await driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] })
      await started
      await worker.close({ force: true })
      expect(finished).toBe(false)
      // Let the abandoned job run to completion against the now-closed
      // consumer while the test is still up, so whatever its late ack/nack
      // does surfaces here rather than after teardown.
      await new Promise((r) => setTimeout(r, IN_FLIGHT_MS * 2))
      await driver.close()
    })

    it('driver.close() closes workers it created and does not hang', async () => {
      const worker = await driver.work(async () => {})
      // Must resolve even though the worker was never closed by the caller.
      await expect(driver.close()).resolves.toBeUndefined()
      // Teardown must stay safe in either order.
      await expect(worker.close()).resolves.toBeUndefined()
    })

    it('close() is idempotent', async () => {
      await driver.close()
      await expect(driver.close()).resolves.toBeUndefined()
    })

    it('enqueue rejects after close()', async () => {
      await driver.close()
      await expect(driver.enqueue({ mediaId: 'm1', conversionNames: ['thumb'] })).rejects.toThrow()
    })
  })
}
