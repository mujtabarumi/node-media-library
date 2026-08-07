# Queue Driver Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `QueueDriver` by deployment model so constructing a `MediaLibrary` can never turn a web process into a broker consumer, add an explicit worker entrypoint, and ship a RabbitMQ adapter.

**Architecture:** Expand/contract migration. Tasks 1–2 add the new interface surface alongside the old one, Task 3 switches core's wiring onto it, Task 4 deletes the old surface. Every task leaves `pnpm -r typecheck` and `pnpm -r test` green — no task is verified against a red repo. Tasks 5–7 build on the settled interface.

**Tech Stack:** TypeScript 6 (ESM, `.js` import suffixes), vitest 4, pnpm workspaces, bullmq 6, amqplib 0.10.

**Spec:** [docs/superpowers/specs/2026-08-08-queue-driver-redesign-design.md](../specs/2026-08-08-queue-driver-redesign-design.md)

## Global Constraints

- Node floor is `>=22`; `@types/node` stays on `^22`, `typescript` on `^6`, `flydrive` on `^1`. Never bump these majors.
- ESM everywhere. Relative imports carry a `.js` suffix even in TypeScript source.
- Prettier: no semicolons, single quotes, 2-space indent, 100 columns. `pnpm format` before committing; CI gates on `pnpm format:check`. Note `.prettierignore` excludes `**/package.json` and `docs/superpowers/plans` — do not reformat either.
- Tests live in each package's `test/` directory, never colocated in `src/`.
- Every package needs BOTH `exports` (→ `src/*.ts`) and `publishConfig.exports` (→ `dist/*.js` + `dist/*.d.ts`). Adding an entry point means updating both.
- Adapters depend only on `@node-media-library/core`, never on a sibling adapter. Core never depends on an adapter.
- Docs must match shipped behavior. A README or JSDoc claim that over- or under-states the code is a defect, fixed in the same task.
- Broker-backed test suites gate on an env var (`REDIS_URL`, `AMQP_URL`) via `describe.skipIf`, paired with an ungated companion test covering the broker-missing path. Local skips are expected; CI is the authority.
- Conventional Commits with a package scope minus the `@node-media-library/` prefix: `feat(core):`, `fix(bullmq):`, `feat(core,bullmq):`.

## File Structure

**Modified:**

- `packages/core/src/queue.ts` — interface definitions + the two in-process drivers. Gains `QueueWorker`, `WorkOptions`, `InProcessQueueDriver`, `BrokerQueueDriver`.
- `packages/core/src/testing/queue-contract.ts` — splits into in-process and broker contract functions.
- `packages/core/src/config.ts` — `queue` field type widens to the driver union.
- `packages/core/src/library.ts` — conditional attach, `startWorker()`, `close()`.
- `packages/core/src/cli/run.ts` — `worker` command, config-file convention.
- `packages/bullmq/src/driver.ts` — becomes a `BrokerQueueDriver`; generation counter deleted.
- `.github/workflows/ci.yml` — rabbitmq service container.

**Created:**

- `packages/rabbitmq/` — new package: `src/driver.ts`, `src/index.ts`, `test/driver.test.ts`, plus the standard `package.json` / `tsconfig.json` / `tsconfig.build.json` / `vitest.config.ts` / `README.md` / `LICENSE`.
- `packages/core/docs/writing-a-queue-driver.md` — the driver-authoring guide.

---

### Task 1: New interface types and in-process drivers

Adds the new types and `attach()`, keeping `registerProcessor()` working so nothing breaks yet. Also fixes `deferDriver.close()` to actually drain.

**Files:**

- Modify: `packages/core/src/queue.ts`
- Modify: `packages/core/src/testing/queue-contract.ts`
- Test: `packages/core/test/queue.test.ts`

**Interfaces:**

- Consumes: nothing (first task).
- Produces: `QueueDriver` (base: `enqueue`, `close`), `InProcessQueueDriver` (adds `attach(processor: ConversionProcessor): void`), `BrokerQueueDriver` (adds `work(processor: ConversionProcessor, opts?: WorkOptions): Promise<QueueWorker>`), `QueueWorker` (`close(opts?: { force?: boolean }): Promise<void>`), `WorkOptions` (`{ concurrency?: number }`), `AnyQueueDriver`, `runInProcessQueueDriverContract(name, factory, opts?)`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/queue.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @node-media-library/core test queue`
Expected: FAIL — `d.attach is not a function`.

- [ ] **Step 3: Add the new types to `packages/core/src/queue.ts`**

Replace the existing `QueueDriver` interface (keeping `ConversionJob` and `ConversionProcessor` exactly as they are) with:

```ts
export interface QueueDriver {
  enqueue(job: ConversionJob): Promise<void>
  close(): Promise<void>
  /** @deprecated Use `attach` (in-process) or `work` (broker). Removed in Task 4. */
  registerProcessor?(fn: ConversionProcessor): void
}

/**
 * Consumes in the same process that produces. Core attaches its processor at
 * construction — there is no separate worker process.
 */
export interface InProcessQueueDriver extends QueueDriver {
  attach(processor: ConversionProcessor): void
}

/**
 * Backed by an external broker. Consuming requires an explicit
 * `MediaLibrary.startWorker()` in a dedicated process.
 */
export interface BrokerQueueDriver extends QueueDriver {
  work(processor: ConversionProcessor, opts?: WorkOptions): Promise<QueueWorker>
}

export interface QueueWorker {
  /** Stops consuming. Waits for in-flight jobs to settle unless `force`. */
  close(opts?: { force?: boolean }): Promise<void>
}

export interface WorkOptions {
  /** Max jobs processed concurrently. Driver default applies if omitted. */
  concurrency?: number
}

/** Any driver core accepts as configuration. */
export type AnyQueueDriver = InProcessQueueDriver | BrokerQueueDriver
```

- [ ] **Step 4: Rewrite the two in-process drivers**

Replace `syncDriver` and `deferDriver` in the same file:

```ts
/**
 * Synchronous in-process driver: `enqueue` awaits the processor inline, so
 * processor errors propagate directly to the `enqueue` caller.
 */
export function syncDriver(): InProcessQueueDriver {
  let processor: ConversionProcessor | undefined
  let closed = false

  const driver: InProcessQueueDriver = {
    async enqueue(job) {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      if (!processor) {
        throw new MediaLibraryError('no processor registered')
      }
      await processor(job)
    },

    attach(fn) {
      processor = fn
    },

    async close() {
      closed = true
    },
  }

  driver.registerProcessor = driver.attach
  return driver
}

/**
 * Deferred in-process driver: `enqueue` resolves immediately and the processor
 * runs on a later tick via `setImmediate`. Processor errors are caught and
 * logged (never surfaced as unhandled rejections) — the engine is responsible
 * for emitting `conversion:failed` itself.
 *
 * `close()` waits for every already-scheduled callback to settle before
 * resolving, so a caller that awaits it observes no further processor side
 * effects.
 */
export function deferDriver(): InProcessQueueDriver {
  let processor: ConversionProcessor | undefined
  let closed = false
  const pending = new Set<Promise<void>>()

  const driver: InProcessQueueDriver = {
    async enqueue(job) {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      if (!processor) {
        throw new MediaLibraryError('no processor registered')
      }
      const currentProcessor = processor
      const settled = new Promise<void>((resolve) => {
        setImmediate(() => {
          Promise.resolve()
            .then(() => currentProcessor(job))
            .catch((err) => {
              console.error('Error processing conversion job:', err)
            })
            .finally(resolve)
        })
      })
      pending.add(settled)
      void settled.finally(() => pending.delete(settled))
    },

    attach(fn) {
      processor = fn
    },

    async close() {
      closed = true
      await Promise.all([...pending])
    },
  }

  driver.registerProcessor = driver.attach
  return driver
}
```

- [ ] **Step 5: Add the in-process contract function**

In `packages/core/src/testing/queue-contract.ts`, add a new export beside the existing `runQueueDriverContract` (leave that one untouched for now — Task 4 deletes it). Extend the existing type import to `import type { ConversionJob, InProcessQueueDriver, QueueDriver } from '../queue.js'`.

```ts
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
```

- [ ] **Step 6: Wire the new contract into the core queue tests**

In `packages/core/test/queue.test.ts`, add alongside the existing `runQueueDriverContract` calls:

```ts
import { runInProcessQueueDriverContract } from '../src/testing/queue-contract.js'

runInProcessQueueDriverContract('syncDriver', async () => syncDriver())
runInProcessQueueDriverContract('deferDriver', async () => deferDriver(), {
  waitForAsync: () => new Promise((r) => setImmediate(r)),
})
```

- [ ] **Step 7: Run the full core suite**

Run: `pnpm --filter @node-media-library/core test`
Expected: PASS. Both the old and new contract suites run green.

- [ ] **Step 8: Typecheck the workspace**

Run: `pnpm -r typecheck`
Expected: PASS — `registerProcessor` is still present (optional) on `QueueDriver`, so `packages/bullmq` still compiles.

- [ ] **Step 9: Format and commit**

```bash
pnpm format
git add packages/core/src/queue.ts packages/core/src/testing/queue-contract.ts packages/core/test/queue.test.ts
git commit -m "feat(core): add in-process/broker queue driver types and drain deferDriver"
```

---

### Task 2: BullMQ driver implements `work()`

**Files:**

- Modify: `packages/bullmq/src/driver.ts`
- Modify: `packages/core/src/testing/queue-contract.ts`
- Test: `packages/bullmq/test/driver.test.ts`

**Interfaces:**

- Consumes: `BrokerQueueDriver`, `QueueWorker`, `WorkOptions` from Task 1.
- Produces: `bullmqDriver(opts: BullmqDriverOptions): BrokerQueueDriver`, `runBrokerQueueDriverContract(name, factory, opts?)`.

- [ ] **Step 1: Write the failing test**

Add to `packages/bullmq/test/driver.test.ts`:

```ts
it('work() after close() rejects without touching redis', async () => {
  const d = bullmqDriver({ connection: { host: 'localhost' } })
  await d.close()
  await expect(d.work(async () => {})).rejects.toThrow('queue driver is closed')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @node-media-library/bullmq test`
Expected: FAIL — `d.work is not a function`.

- [ ] **Step 3: Rewrite the driver**

Replace the whole of `packages/bullmq/src/driver.ts`:

```ts
import { Queue, Worker } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'
import {
  MediaLibraryError,
  type BrokerQueueDriver,
  type ConversionJob,
  type ConversionProcessor,
  type QueueWorker,
  type WorkOptions,
} from '@node-media-library/core'

const DEFAULT_QUEUE_NAME = 'media-conversions'
const DEFAULT_WORKER_CONCURRENCY = 2

export interface BullmqDriverOptions {
  /** ioredis-compatible connection options or instance; passed through to BullMQ. */
  connection: unknown
  /** @defaultValue 'media-conversions' */
  queueName?: string
  /** Default concurrency, overridden per-call by `WorkOptions.concurrency`. @defaultValue 2 */
  workerConcurrency?: number
}

/**
 * BullMQ-backed broker driver. The `Queue` is created lazily on first
 * `enqueue`, and a `Worker` only ever on an explicit `work()` call — so
 * constructing the driver, or holding one in a web process, never consumes.
 */
export function bullmqDriver(opts: BullmqDriverOptions): BrokerQueueDriver {
  const connection = opts.connection as ConnectionOptions
  const queueName = opts.queueName ?? DEFAULT_QUEUE_NAME
  const defaultConcurrency = opts.workerConcurrency ?? DEFAULT_WORKER_CONCURRENCY

  let queue: Queue<ConversionJob> | undefined
  const workers = new Set<Worker<ConversionJob>>()
  let closed = false

  function getQueue(): Queue<ConversionJob> {
    if (!queue) {
      queue = new Queue<ConversionJob>(queueName, { connection })
    }
    return queue
  }

  return {
    async enqueue(job: ConversionJob) {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      await getQueue().add('convert', job)
    },

    async work(fn: ConversionProcessor, workOpts?: WorkOptions): Promise<QueueWorker> {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      const worker = new Worker<ConversionJob>(queueName, async (j) => fn(j.data), {
        connection,
        concurrency: workOpts?.concurrency ?? defaultConcurrency,
      })
      workers.add(worker)
      await worker.waitUntilReady()

      return {
        async close(closeOpts?: { force?: boolean }) {
          workers.delete(worker)
          // BullMQ's close(force) skips waiting for active jobs.
          await worker.close(closeOpts?.force ?? false)
        },
      }
    },

    async close() {
      if (closed) return
      closed = true
      await Promise.all([...workers].map((w) => w.close()))
      workers.clear()
      await queue?.close()
    },
  }
}
```

- [ ] **Step 4: Add the broker contract function**

In `packages/core/src/testing/queue-contract.ts`, add `BrokerQueueDriver` to the type import and append:

```ts
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
```

Both drivers must therefore tolerate `worker.close()` after `driver.close()`. In bullmq's `work()`
the returned closer calls `worker.close()` on an already-closed BullMQ worker, which is a no-op; in
rabbitmq's, `channel.cancel`/`channel.close` on an already-closed channel must be guarded. Add that
guard when implementing Task 6 Step 4:

```ts
        async close(closeOpts?: { force?: boolean }) {
          if (!consumerChannels.has(channel)) return
          // ... existing body
        },
```

- [ ] **Step 5: Point the bullmq suite at the broker contract**

In `packages/bullmq/test/driver.test.ts`, replace the `runQueueDriverContract` import and call with:

```ts
import { runBrokerQueueDriverContract } from '@node-media-library/core/testing'

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
```

Also delete the now-stale `registerProcessor after close() throws without touching redis` test — the `work() after close()` test from Step 1 replaces it.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @node-media-library/bullmq test && pnpm -r typecheck`
Expected: PASS. Contract suite skips locally without `REDIS_URL`; the two ungated tests run.

- [ ] **Step 7: Format and commit**

```bash
pnpm format
git add packages/bullmq packages/core/src/testing/queue-contract.ts
git commit -m "feat(bullmq): implement work() and drop the worker generation counter"
```

---

### Task 3: Core wiring — conditional attach, `startWorker()`, `close()`

**Files:**

- Modify: `packages/core/src/config.ts:12`, `packages/core/src/config.ts:37`, `packages/core/src/config.ts:65`
- Modify: `packages/core/src/library.ts:21`, `packages/core/src/library.ts:70-72`
- Test: `packages/core/test/queue-wiring.test.ts` (create)

**Interfaces:**

- Consumes: `AnyQueueDriver`, `QueueWorker`, `WorkOptions` from Task 1.
- Produces: `MediaLibrary.startWorker(opts?: WorkOptions): Promise<QueueWorker>`, `MediaLibrary.close(): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/queue-wiring.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createMediaLibrary, syncDriver } from '../src/index.js'
import type { BrokerQueueDriver, ConversionProcessor, QueueWorker } from '../src/index.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'

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
    storage: { disks: { default: { driver: 'fs', root: './.tmp-queue-wiring' } } },
    models: { User: {} },
    queue,
  })
}

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
```

Check the repository import first — run `grep -n "export" packages/core/src/repository/in-memory.ts | head -3` and use whatever the class is actually named.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @node-media-library/core test queue-wiring`
Expected: FAIL — `library.startWorker is not a function`.

- [ ] **Step 3: Widen the config type**

In `packages/core/src/config.ts`, change line 12 to `import type { AnyQueueDriver } from './queue.js'`, then line 37 to:

```ts
  /** Default `syncDriver()` (conversions run inline, synchronously). */
  queue?: AnyQueueDriver
```

and line 65 to:

```ts
  readonly queue: AnyQueueDriver
```

Line 114 (`queue: config.queue ?? syncDriver()`) is unchanged.

- [ ] **Step 4: Make the constructor attach conditional**

In `packages/core/src/library.ts`, replace lines 70–72:

```ts
    // Only in-process drivers attach here. A broker driver is left untouched,
    // so a process that merely constructs a MediaLibrary is a pure producer —
    // consuming requires an explicit startWorker() in a worker process.
    if ('attach' in this.resolved.queue) {
      this.resolved.queue.attach((job) => this.engine.perform(job.mediaId, job.conversionNames))
    }
```

- [ ] **Step 5: Add `startWorker()` and `close()`**

Add `QueueWorker` and `WorkOptions` to the type import from `./queue.js` on line 21, then add these methods to the `MediaLibrary` class after `performConversions`:

```ts
  /**
   * Starts consuming conversion jobs from the configured broker driver.
   * Call this only in a dedicated worker process — a web process should
   * construct the library and never call it.
   *
   * Throws when the configured driver is in-process, since those run
   * conversions inline and have no separate worker to start.
   */
  async startWorker(opts?: WorkOptions): Promise<QueueWorker> {
    const driver = this.resolved.queue
    if (!('work' in driver)) {
      throw new MediaLibraryError(
        'configured queue driver is in-process: conversions already run in this process, so there is no worker to start',
      )
    }
    return driver.work((job) => this.engine.perform(job.mediaId, job.conversionNames), opts)
  }

  /** Releases the configured queue driver's resources. */
  async close(): Promise<void> {
    await this.resolved.queue.close()
  }
```

Verify `MediaLibraryError` is imported: `grep -n "MediaLibraryError" packages/core/src/library.ts`. If absent, add `import { MediaLibraryError } from './errors.js'`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @node-media-library/core test && pnpm -r typecheck`
Expected: PASS — all four new tests plus every existing suite.

- [ ] **Step 7: Format and commit**

```bash
pnpm format
git add packages/core/src/config.ts packages/core/src/library.ts packages/core/test/queue-wiring.test.ts
git commit -m "fix(core): stop broker drivers from consuming at construction"
```

---

### Task 4: Remove `registerProcessor` (the breaking change)

**Files:**

- Modify: `packages/core/src/queue.ts`
- Modify: `packages/core/src/testing/queue-contract.ts`
- Modify: `packages/core/test/queue.test.ts`, `packages/core/test/exports.test.ts:132-145`

**Interfaces:**

- Consumes: everything from Tasks 1–3.
- Produces: `QueueDriver` with no `registerProcessor`; `runQueueDriverContract` no longer exported.

- [ ] **Step 1: Delete the deprecated member**

In `packages/core/src/queue.ts`, remove the `registerProcessor?` line from the `QueueDriver` interface, and remove both `driver.registerProcessor = driver.attach` lines from `syncDriver` and `deferDriver`.

- [ ] **Step 2: Delete the old contract function**

In `packages/core/src/testing/queue-contract.ts`, delete the entire `runQueueDriverContract` function and drop `QueueDriver` from the type import if it becomes unused. Keep `runInProcessQueueDriverContract` and `runBrokerQueueDriverContract`.

- [ ] **Step 3: Remove stale test references**

In `packages/core/test/queue.test.ts`, delete the two `runQueueDriverContract(...)` calls and their import.

In `packages/core/test/exports.test.ts`, replace the `exports syncDriver` / `exports deferDriver` / typed-driver tests (lines 132–145) with:

```ts
it('exports the queue driver factories and types', async () => {
  const mod = await import('../src/index.js')
  expect(mod.syncDriver).toBeDefined()
  expect(mod.deferDriver).toBeDefined()
  const driver: import('../src/index.js').InProcessQueueDriver = mod.syncDriver()
  expect(typeof driver.attach).toBe('function')
  expect('registerProcessor' in driver).toBe(false)
})
```

- [ ] **Step 4: Run the full workspace suite**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: PASS. If anything still calls `registerProcessor`, the typecheck names the file — fix it there.

- [ ] **Step 5: Format and commit**

```bash
pnpm format
git add packages/core
git commit -m "feat(core)!: remove registerProcessor in favour of attach/work"
```

---

### Task 5: `worker` CLI command and config-file convention

**Files:**

- Modify: `packages/core/src/cli/run.ts`
- Test: `packages/core/test/cli.test.ts:30`

**Interfaces:**

- Consumes: `MediaLibrary.startWorker()`, `MediaLibrary.close()` from Task 3.
- Produces: `CliLibrary` gains `startWorker` and `close`; `resolveConfigPath(explicit?: string): string | undefined`.

- [ ] **Step 1: Extend the test stub and write the failing tests**

In `packages/core/test/cli.test.ts`, add two members to the `CliLibrary` stub object at line 30 so every existing test still compiles:

```ts
    startWorker: async () => ({ close: async () => {} }),
    close: async () => {},
```

Then append:

```ts
describe('worker command', () => {
  it('starts a worker and returns 0 on SIGTERM', async () => {
    let workerClosed = false
    let libraryClosed = false
    const { deps, recorder } = makeDeps({
      startWorker: async () => ({
        close: async () => {
          workerClosed = true
        },
      }),
      close: async () => {
        libraryClosed = true
      },
    })
    const run = runCli(['worker', '--config', './x.js'], deps)
    setImmediate(() => process.emit('SIGTERM'))
    expect(await run).toBe(0)
    expect(workerClosed).toBe(true)
    expect(libraryClosed).toBe(true)
    expect(recorder.logs.join('\n')).toContain('Worker started')
  })

  it('reports a clear error when the driver has no worker', async () => {
    const { deps, recorder } = makeDeps({
      startWorker: async () => {
        throw new MediaLibraryError('configured queue driver is in-process')
      },
    })
    expect(await runCli(['worker', '--config', './x.js'], deps)).toBe(1)
    expect(recorder.errors.join('\n')).toContain('in-process')
  })

  it('rejects --dry-run on the worker command', async () => {
    const { deps } = makeDeps()
    expect(await runCli(['worker', '--config', './x.js', '--dry-run'], deps)).toBe(1)
  })
})
```

Import `MediaLibraryError` from `../src/errors.js` if the file does not already.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @node-media-library/core test cli`
Expected: FAIL — `Unknown command: worker`.

- [ ] **Step 3: Extend `CliLibrary` and the flag table**

In `packages/core/src/cli/run.ts`, add to the `CliLibrary` interface:

```ts
  startWorker(opts?: { concurrency?: number }): Promise<{
    close(opts?: { force?: boolean }): Promise<void>
  }>
  close(): Promise<void>
```

Change `FLAGS_BY_COMMAND` to:

```ts
const FLAGS_BY_COMMAND: Record<'regenerate' | 'clean' | 'worker', readonly string[]> = {
  regenerate: ['model', 'ids', 'only', 'only-missing', 'with-responsive'],
  clean: ['dry-run', 'delete-orphaned', 'rate-limit'],
  worker: ['concurrency', 'shutdown-timeout'],
}
```

Add to the `parseArgs` options object and to the `values` type annotation:

```ts
        concurrency: { type: 'string' },
        'shutdown-timeout': { type: 'string' },
```

Change the command guard:

```ts
  if (command !== 'regenerate' && command !== 'clean' && command !== 'worker') {
```

Add to `USAGE`, after the `clean` block:

```
  worker --config <path> [--concurrency <n>] [--shutdown-timeout <seconds>]
      Consume conversion jobs from the configured broker driver until SIGTERM/SIGINT.
```

and to its options list:

```
  --concurrency <n>          worker: max jobs processed at once
  --shutdown-timeout <s>     worker: seconds to wait for in-flight jobs on shutdown (default 30)
```

- [ ] **Step 4: Implement the worker branch**

In `runCli`, inside the existing `try` block, before the `regenerate` branch:

```ts
    if (command === 'worker') {
      const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency)
      if (concurrency !== undefined && (!Number.isFinite(concurrency) || concurrency <= 0)) {
        deps.error('--concurrency must be a positive number.')
        return 1
      }
      const timeoutSeconds =
        values['shutdown-timeout'] === undefined ? 30 : Number(values['shutdown-timeout'])
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
        deps.error('--shutdown-timeout must be a positive number.')
        return 1
      }

      const worker = await library.startWorker(
        concurrency === undefined ? undefined : { concurrency },
      )
      deps.log('Worker started. Press Ctrl+C to stop.')

      await new Promise<void>((resolve) => {
        const stop = () => {
          process.off('SIGTERM', stop)
          process.off('SIGINT', stop)
          resolve()
        }
        process.once('SIGTERM', stop)
        process.once('SIGINT', stop)
      })

      deps.log('Shutting down; waiting for in-flight jobs...')
      // Kubernetes SIGKILLs after its grace period, so an unbounded drain is
      // killed mid-job anyway — bound it and report the outcome honestly.
      const timedOut = await Promise.race([
        worker.close().then(() => false),
        new Promise<boolean>((r) => setTimeout(() => r(true), timeoutSeconds * 1000)),
      ])
      if (timedOut) {
        deps.error(`Shutdown timed out after ${timeoutSeconds}s; abandoning in-flight jobs.`)
        await worker.close({ force: true })
      }
      await library.close()
      deps.log('Worker stopped.')
      return 0
    }
```

- [ ] **Step 5: Add the config-file convention**

Add near the top of `packages/core/src/cli/run.ts` (import `existsSync` from `node:fs`; `resolve` is already imported from `node:path`):

```ts
const CONFIG_BASENAMES = [
  'medialibrary.config.ts',
  'medialibrary.config.mts',
  'medialibrary.config.js',
  'medialibrary.config.mjs',
] as const

/**
 * Resolves the config module path. An explicit `--config` always wins;
 * otherwise the conventional filenames are probed in cwd, matching how
 * vitest/drizzle/playwright resolve theirs.
 * @internal
 */
export function resolveConfigPath(explicit?: string): string | undefined {
  if (explicit) return explicit
  return CONFIG_BASENAMES.map((name) => resolve(name)).find((path) => existsSync(path))
}
```

Replace the `if (!values.config)` guard with:

```ts
  const configPath = resolveConfigPath(values.config)
  if (!configPath) {
    deps.error(
      `Missing --config <path>, and no ${CONFIG_BASENAMES.join(' / ')} found in the current directory.`,
    )
    deps.error(USAGE)
    return 1
  }
```

and change `deps.loadLibrary(values.config)` to `deps.loadLibrary(configPath)`.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @node-media-library/core test cli && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 7: Format and commit**

```bash
pnpm format
git add packages/core/src/cli/run.ts packages/core/test/cli.test.ts
git commit -m "feat(core): add worker CLI command and medialibrary.config resolution"
```

---

### Task 6: `@node-media-library/rabbitmq`

**Files:**

- Create: `packages/rabbitmq/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `src/driver.ts`, `src/index.ts`, `test/driver.test.ts`, `README.md`, `LICENSE`
- Modify: `.github/workflows/ci.yml:15-18`, `.github/workflows/ci.yml:30`

**Interfaces:**

- Consumes: `BrokerQueueDriver`, `QueueWorker`, `WorkOptions` (Task 1); `runBrokerQueueDriverContract` (Task 2).
- Produces: `rabbitmqDriver(opts: RabbitmqDriverOptions): BrokerQueueDriver`, `AmqpLikeConnection`, `RabbitmqDriverOptions`.

- [ ] **Step 1: Scaffold the package**

Copy the config files from the bullmq package, which is the canonical shape:

```bash
mkdir -p packages/rabbitmq/src packages/rabbitmq/test
cp packages/bullmq/tsconfig.json packages/bullmq/tsconfig.build.json packages/bullmq/vitest.config.ts packages/rabbitmq/
cp packages/bullmq/LICENSE packages/rabbitmq/LICENSE
```

Write `packages/rabbitmq/package.json` (`.prettierignore` excludes `**/package.json`, so match this hand formatting exactly):

```json
{
  "name": "@node-media-library/rabbitmq",
  "version": "0.0.0",
  "type": "module",
  "description": "RabbitMQ (amqplib) queue adapter for @node-media-library/core conversion jobs.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/mujtabarumi/node-media-library.git",
    "directory": "packages/rabbitmq"
  },
  "homepage": "https://github.com/mujtabarumi/node-media-library/tree/main/packages/rabbitmq#readme",
  "bugs": { "url": "https://github.com/mujtabarumi/node-media-library/issues" },
  "keywords": ["media-library", "uploads", "conversions", "rabbitmq", "amqp", "queue"],
  "engines": { "node": ">=22" },
  "files": ["dist", "README.md", "LICENSE"],
  "exports": { ".": "./src/index.ts" },
  "publishConfig": {
    "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.build.json",
    "prepublishOnly": "pnpm build",
    "prepack": "node ../../scripts/ensure-pnpm-pack.mjs"
  },
  "dependencies": { "@node-media-library/core": "workspace:*" },
  "peerDependencies": { "amqplib": "^0.10" },
  "devDependencies": {
    "@types/amqplib": "^0.10.7",
    "@types/node": "^22.20.1",
    "amqplib": "^0.10.5",
    "typescript": "^6.0.3",
    "vitest": "^4.1.10"
  }
}
```

Then run `pnpm install`.

- [ ] **Step 2: Write the failing tests**

Create `packages/rabbitmq/test/driver.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { runBrokerQueueDriverContract } from '@node-media-library/core/testing'
import { rabbitmqDriver } from '../src/driver.js'

const hasAmqp = !!process.env.AMQP_URL
if (!hasAmqp) console.warn('[rabbitmq tests] AMQP_URL not set — driver contract suite skipped')

describe.skipIf(!hasAmqp)('rabbitmqDriver contract (requires AMQP_URL)', () => {
  runBrokerQueueDriverContract(
    'rabbitmqDriver',
    async () =>
      rabbitmqDriver({ url: process.env.AMQP_URL!, queueName: `mlq-${randomUUID()}` }),
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
```

The `does not close a caller-supplied connection` test's stub returns a rejecting `createChannel`, which is never called — `close()` with no channels opened must not touch it. If TypeScript objects to the stub's shape, cast it `as AmqpLikeConnection`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @node-media-library/rabbitmq test`
Expected: FAIL — cannot resolve `../src/driver.js`.

- [ ] **Step 4: Implement the driver**

Create `packages/rabbitmq/src/driver.ts`:

```ts
import amqp from 'amqplib'
import {
  MediaLibraryError,
  type BrokerQueueDriver,
  type ConversionJob,
  type ConversionProcessor,
  type QueueWorker,
  type WorkOptions,
} from '@node-media-library/core'

const DEFAULT_QUEUE_NAME = 'media-conversions'
const DEFAULT_PREFETCH = 2

/**
 * The subset of an amqplib connection this driver uses. Structural rather
 * than nominal so any managed wrapper — `amqp-connection-manager`, an
 * in-house pool — satisfies it without importing our types.
 */
export interface AmqpLikeConnection {
  createChannel(): Promise<amqp.Channel>
  close(): Promise<void>
}

interface SharedOptions {
  /** @defaultValue 'media-conversions' */
  queueName?: string
  /** Default unacked-message window per worker. @defaultValue 2 */
  prefetch?: number
  /** Exchange failed jobs are dead-lettered to. Omit to drop them. */
  deadLetterExchange?: string
}

export type RabbitmqDriverOptions = SharedOptions &
  ({ url: string; connection?: never } | { connection: AmqpLikeConnection; url?: never })

/**
 * RabbitMQ-backed broker driver.
 *
 * Connections are opened lazily on first `enqueue`/`work`, so constructing
 * the driver never touches the broker. Delivery is at-least-once: a job may
 * be redelivered after a crash, so processors must be idempotent.
 *
 * Ownership: with `url` the driver opened the connection and closes it. With
 * `connection` the caller owns it, and `close()` closes only the channels
 * this driver opened — tearing down a shared connection would break every
 * other consumer in the process.
 */
export function rabbitmqDriver(opts: RabbitmqDriverOptions): BrokerQueueDriver {
  if (!opts.url && !opts.connection) {
    throw new MediaLibraryError('rabbitmqDriver requires either `url` or `connection`')
  }

  const queueName = opts.queueName ?? DEFAULT_QUEUE_NAME
  const defaultPrefetch = opts.prefetch ?? DEFAULT_PREFETCH
  const ownsConnection = !opts.connection

  let connection: AmqpLikeConnection | undefined = opts.connection
  let producerChannel: amqp.Channel | undefined
  const consumerChannels = new Set<amqp.Channel>()
  let closed = false

  const queueArgs = opts.deadLetterExchange
    ? { durable: true, arguments: { 'x-dead-letter-exchange': opts.deadLetterExchange } }
    : { durable: true }

  async function getConnection(): Promise<AmqpLikeConnection> {
    if (!connection) {
      connection = (await amqp.connect(opts.url!)) as unknown as AmqpLikeConnection
    }
    return connection
  }

  async function getProducerChannel(): Promise<amqp.Channel> {
    if (!producerChannel) {
      producerChannel = await (await getConnection()).createChannel()
      await producerChannel.assertQueue(queueName, queueArgs)
    }
    return producerChannel
  }

  return {
    async enqueue(job: ConversionJob) {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      const channel = await getProducerChannel()
      // `persistent` must be paired with the durable queue above: a durable
      // queue holding non-persistent messages still loses them on restart.
      channel.sendToQueue(queueName, Buffer.from(JSON.stringify(job)), { persistent: true })
    },

    async work(fn: ConversionProcessor, workOpts?: WorkOptions): Promise<QueueWorker> {
      if (closed) {
        throw new MediaLibraryError('queue driver is closed')
      }
      const channel = await (await getConnection()).createChannel()
      consumerChannels.add(channel)
      await channel.assertQueue(queueName, queueArgs)
      await channel.prefetch(workOpts?.concurrency ?? defaultPrefetch)

      const inFlight = new Set<Promise<void>>()

      const { consumerTag } = await channel.consume(queueName, (msg) => {
        if (!msg) return
        const settled = (async () => {
          try {
            await fn(JSON.parse(msg.content.toString()) as ConversionJob)
            channel.ack(msg)
          } catch {
            // requeue: false — dead-letter it rather than loop a poison
            // message forever. Retry policy belongs to the broker.
            channel.nack(msg, false, false)
          }
        })()
        inFlight.add(settled)
        void settled.finally(() => inFlight.delete(settled))
      })

      return {
        async close(closeOpts?: { force?: boolean }) {
          await channel.cancel(consumerTag)
          if (!closeOpts?.force) {
            await Promise.all([...inFlight])
          }
          consumerChannels.delete(channel)
          await channel.close()
        },
      }
    },

    async close() {
      if (closed) return
      closed = true
      await Promise.all([...consumerChannels].map((c) => c.close()))
      consumerChannels.clear()
      await producerChannel?.close()
      producerChannel = undefined
      if (ownsConnection) {
        await connection?.close()
        connection = undefined
      }
    },
  }
}
```

Create `packages/rabbitmq/src/index.ts`:

```ts
export { rabbitmqDriver } from './driver.js'
export type { RabbitmqDriverOptions, AmqpLikeConnection } from './driver.js'
```

- [ ] **Step 5: Add the CI service container**

In `.github/workflows/ci.yml`, add under `services:` beside `redis`:

```yaml
      rabbitmq:
        image: rabbitmq:4
        ports: ['5672:5672']
        options: >-
          --health-cmd "rabbitmq-diagnostics -q ping"
          --health-interval 10s --health-timeout 5s --health-retries 10
```

and replace the test step's single-line `env:` with:

```yaml
        env:
          REDIS_URL: 'redis://localhost:6379'
          AMQP_URL: 'amqp://guest:guest@localhost:5672'
```

- [ ] **Step 6: Write the README**

Create `packages/rabbitmq/README.md` mirroring `packages/bullmq/README.md`'s structure, covering: install, the two mutually exclusive options forms (`url` vs `connection`), connection ownership on `close()`, the at-least-once guarantee and the idempotency requirement it places on processors, `deadLetterExchange` and why retry policy stays with the broker, and a worker-process example using `startWorker()`.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @node-media-library/rabbitmq test && pnpm -r typecheck && pnpm -r build`
Expected: PASS. The contract suite skips locally without `AMQP_URL`; the five ungated tests run. To exercise it fully: `docker run -d -p 5672:5672 rabbitmq:4`, then re-run with `AMQP_URL=amqp://guest:guest@localhost:5672`.

- [ ] **Step 8: Format and commit**

```bash
pnpm format
git add packages/rabbitmq .github/workflows/ci.yml pnpm-lock.yaml
git commit -m "feat(rabbitmq): add amqplib-backed queue driver"
```

---

### Task 7: Documentation and changeset

**Files:**

- Create: `packages/core/docs/writing-a-queue-driver.md`, `.changeset/queue-driver-redesign.md`
- Modify: `packages/core/README.md`, `packages/bullmq/README.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-07-26-node-media-library-design.md`

**Interfaces:**

- Consumes: the final API from Tasks 1–6.
- Produces: no code.

- [ ] **Step 1: Write the driver-authoring guide**

Create `packages/core/docs/writing-a-queue-driver.md` covering:

- Choosing between `InProcessQueueDriver` and `BrokerQueueDriver`, and why the distinction exists — a broker driver must never consume at construction, because a web process constructs the library too.
- The full interface with signatures, copied from `packages/core/src/queue.ts`.
- `close()` semantics: `QueueWorker.close()` waits for in-flight jobs unless `force`; `QueueDriver.close()` releases producer resources and any workers it created.
- **Delivery is at-least-once, so processors must be idempotent.** State that `markConversionGenerated` and `mergeResponsiveImages` are merge-based rather than replace-based, so redelivery is already safe.
- Ack/nack/retry/DLQ are driver policy and deliberately absent from the interface.
- How to validate: import `runBrokerQueueDriverContract` from `@node-media-library/core/testing`, gate on your own env var, and follow `packages/rabbitmq/test/driver.test.ts`.

- [ ] **Step 2: Update the core README**

In the queue section: replace `registerProcessor` references with `attach`/`work`; document `startWorker()` and `MediaLibrary.close()`; add the `worker` CLI command and the `medialibrary.config.*` convention; add the environment-selection example with its `default: throw`, plus a note pointing at fail-fast env validation (`envalid`, `zod`, `t3-env`). Link the new guide.

- [ ] **Step 3: Update the bullmq README**

Replace `registerProcessor` usage with `work()`/`startWorker()`, document that `workerConcurrency` is now the default overridden per-call by `WorkOptions.concurrency`, and state that constructing a library no longer starts a consumer.

- [ ] **Step 4: Update CLAUDE.md and the original spec**

In `CLAUDE.md`: add `rabbitmq/` to the package list in the Layout block, and add `AMQP_URL` beside `REDIS_URL` in the binary-gated-tests paragraph. In `docs/superpowers/specs/2026-07-26-node-media-library-design.md`, update any passage describing the old three-method `QueueDriver` to point at the new spec.

- [ ] **Step 5: Write the changeset**

Create `.changeset/queue-driver-redesign.md`:

```markdown
---
'@node-media-library/core': minor
'@node-media-library/bullmq': minor
'@node-media-library/rabbitmq': minor
---

Split `QueueDriver` into `InProcessQueueDriver` (`attach`) and `BrokerQueueDriver` (`work`), and stop
attaching a processor to broker drivers at construction — a process that merely constructs a
`MediaLibrary` no longer consumes conversion jobs. Consuming now requires an explicit
`MediaLibrary.startWorker()`, or the new `node-media-library worker` command.

`registerProcessor` is removed. In-process drivers use `attach`; broker drivers use `work`, which
returns a `QueueWorker` whose `close()` waits for in-flight jobs unless forced. `deferDriver.close()`
now drains its scheduled callbacks instead of resolving while work is still pending.

Adds `@node-media-library/rabbitmq`, an amqplib-backed driver accepting either a `url` or a
caller-owned `connection`.
```

- [ ] **Step 6: Verify the whole workspace**

Run: `pnpm format:check && pnpm -r typecheck && pnpm -r test && pnpm -r build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/docs packages/core/README.md packages/bullmq/README.md CLAUDE.md docs/superpowers/specs .changeset
git commit -m "docs: document the queue driver split, worker command, and rabbitmq adapter"
```

---

## Verification

After Task 7, every claim in the spec should hold:

1. `grep -rn "registerProcessor" packages/` returns nothing.
2. Constructing a `MediaLibrary` with a broker driver opens no worker — covered by `packages/core/test/queue-wiring.test.ts`.
3. `node-media-library worker --config ./medialibrary.config.js` consumes until SIGTERM, then drains.
4. Both broker adapters pass `runBrokerQueueDriverContract` in CI with their service containers running.
