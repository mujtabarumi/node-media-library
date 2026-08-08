import { describe, it, expect, afterEach } from 'vitest'
import { rm } from 'node:fs/promises'
import { createMediaLibrary, syncDriver } from '../src/index.js'
import type { BrokerQueueDriver, ConversionProcessor, QueueWorker } from '../src/index.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'

const TMP_ROOT = './.tmp-queue-wiring'

function fakeBroker(): BrokerQueueDriver & { attached: ConversionProcessor[] } {
  const attached: ConversionProcessor[] = []
  return {
    attached,
    async enqueue() {},
    async work(fn): Promise<QueueWorker> {
      attached.push(fn)
      return { async close() {} }
    },
    async close() {},
  }
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
