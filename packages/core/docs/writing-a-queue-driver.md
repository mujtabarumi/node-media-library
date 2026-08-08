# Writing a queue driver

A queue driver connects `MediaLibrary`'s conversion pipeline to whatever runs the actual conversion
work — inline in the same process, or a broker (Redis, RabbitMQ, ...) consumed by a dedicated worker.
This guide covers the contract you implement and how to validate it.

## `InProcessQueueDriver` vs. `BrokerQueueDriver`

The base `QueueDriver` only produces:

```ts
export interface QueueDriver {
  enqueue(job: ConversionJob): Promise<void>
  close(): Promise<void>
}
```

It is never configured on its own — `MediaLibraryConfig.queue` requires one of the two shapes that
extend it, discriminated structurally (`'attach' in driver`), not by a boolean flag:

- **`InProcessQueueDriver`** consumes in the same process that produces. `attach()` is called once, by
  `MediaLibrary`'s own constructor, wiring the processor before any job can be enqueued.
- **`BrokerQueueDriver`** hands work to an external broker. It never consumes on its own — consuming
  requires an explicit `work()` call, which `MediaLibrary.startWorker()` makes on your behalf from a
  dedicated worker process.

**Why the distinction exists.** Constructing a `MediaLibrary` must never make a process a broker
consumer. A web process, a serverless handler, or a one-off script all construct a `MediaLibrary` just
to read/write media — none of them should silently start pulling conversion jobs off a broker and
running `sharp`/`ffmpeg` inside a process sized for HTTP. An in-process driver attaching eagerly is
correct — inline execution _is_ its entire purpose, and there is no separate worker process to defer
to. A broker driver attaching eagerly is the opposite: it turns every producer into an accidental
consumer. Splitting the interface makes this a type-level distinction instead of a convention a driver
author has to remember.

If you're writing an in-process driver, implement `InProcessQueueDriver`. If you're adapting a broker
(a message queue, a job scheduler, a hosted queue service), implement `BrokerQueueDriver`.

## The full interface

Copied from [`packages/core/src/queue.ts`](../src/queue.ts):

```ts
export interface ConversionJob {
  mediaId: string
  conversionNames: string[]
}

export type ConversionProcessor = (job: ConversionJob) => Promise<void>

export interface QueueDriver {
  enqueue(job: ConversionJob): Promise<void>
  close(): Promise<void>
}

export interface InProcessQueueDriver extends QueueDriver {
  attach(processor: ConversionProcessor): void
}

export interface BrokerQueueDriver extends QueueDriver {
  work(processor: ConversionProcessor, opts?: WorkOptions): Promise<QueueWorker>
}

export interface QueueWorker {
  close(opts?: { force?: boolean }): Promise<void>
}

export interface WorkOptions {
  concurrency?: number
}

export type AnyQueueDriver = InProcessQueueDriver | BrokerQueueDriver
```

The job payload is intentionally minimal: `{ mediaId, conversionNames }`. A worker reloads the media
record and the collection/conversion definitions from the same config module it was started with — the
payload carries no serialized definitions, no file bytes, nothing your driver needs to know how to
transport beyond two strings and a string array.

## `close()` semantics

Two different `close()`s exist, and they mean different things:

- **`QueueWorker.close(opts?)`** stops consuming. By default it waits for in-flight jobs to settle
  before resolving — a job that has already been pulled off the broker and handed to your processor
  gets to finish. Pass `{ force: true }` to abandon in-flight jobs instead (used by the `worker` CLI
  command after its shutdown timeout elapses, since Kubernetes sends `SIGKILL` after its own grace
  period regardless of whether your drain finished).
- **`QueueDriver.close()`** releases producer resources — connections, channels, timers — and closes
  any workers the driver itself created that are still open. It does not imply a graceful drain of
  those workers; if you want jobs to finish first, close the `QueueWorker` returned by `work()`
  yourself, then call `driver.close()`.

`deferDriver()` is a concrete example worth reading
([`packages/core/src/queue.ts`](../src/queue.ts)): its `enqueue()` resolves immediately and schedules
the processor on a later tick via `setImmediate`, but `close()` waits for every already-scheduled
callback to settle before resolving — so a caller that awaits `close()` observes no further processor
side effects afterward, even though nothing was ever "in flight" in the broker sense.

## Delivery is at-least-once — processors must be idempotent

**State this plainly to yourself before you ship a driver: delivery is at-least-once, not
exactly-once.** A crash between your processor's side effects landing and the broker receiving the ack
can cause the same job to be redelivered. Your driver does not get to promise otherwise — no
broker-backed driver in this ecosystem does (BullMQ, RabbitMQ, SQS, Kafka all make the same guarantee,
for the same reason: an ack that arrives after a crash is indistinguishable from one that never
arrives).

This is why `markConversionGenerated` and `mergeResponsiveImages` — the repository primitives the
conversion engine calls after generating a file — are **merge-based rather than replace-based**.
Re-running the same conversion job for the same media and conversion names is already safe: the second
run overwrites the same derived file and flips the same flag to the same value, rather than appending a
duplicate entry or corrupting a JSON blob written by a since-superseded run. You don't need to build
idempotency into your driver's payload or add a dedup layer — the consumer side already tolerates
redelivery. What your driver must not do is turn _ordinary_ processor errors into silent job loss (an
unacked message that's dropped instead of requeued or dead-lettered).

## Ack, nack, retry, and DLQ are driver policy

None of `QueueDriver`, `InProcessQueueDriver`, or `BrokerQueueDriver` mention acking, retry counts, or
dead-letter queues. This is deliberate, not an oversight: retry policy — how many attempts, what
backoff, whether to alert, where a poison message ends up — varies enormously by broker and by
deployment, and the broker almost always implements it better than a generic wrapper would. Ack/nack
timing is entirely up to your driver's internals; `core` only needs to know whether `enqueue()` and
`work()` resolved or rejected. See [`packages/rabbitmq/src/driver.ts`](../../rabbitmq/src/driver.ts)
for one concrete policy: a resolved processor acks the message, a rejected one is `nack`'d without
requeue so a poison message is dead-lettered (or dropped) instead of looping redelivery forever — and
`deadLetterExchange` is exposed as a driver option rather than a core concept.

## Validating your driver

Both flavors of the contract are exported from `@node-media-library/core/testing`:

```ts
import {
  runInProcessQueueDriverContract,
  runBrokerQueueDriverContract,
} from '@node-media-library/core/testing'
```

Call the one matching your driver's shape, gated on your own environment variable so the suite skips
cleanly when the broker isn't available locally (CI is the authority on those paths — see
`packages/rabbitmq/test/driver.test.ts` for the pattern to follow):

```ts
import { randomUUID } from 'node:crypto'
import { describe } from 'vitest'
import { runBrokerQueueDriverContract } from '@node-media-library/core/testing'
import { myBrokerDriver } from '../src/driver.js'

const hasBroker = !!process.env.MY_BROKER_URL
if (!hasBroker)
  console.warn('[my-broker tests] MY_BROKER_URL not set — driver contract suite skipped')

describe.skipIf(!hasBroker)('myBrokerDriver contract (requires MY_BROKER_URL)', () => {
  runBrokerQueueDriverContract(
    'myBrokerDriver',
    async () =>
      myBrokerDriver({ url: process.env.MY_BROKER_URL!, queueName: `mlq-${randomUUID()}` }),
    { waitForAsync: () => new Promise((r) => setTimeout(r, 500)) },
  )
})
```

`packages/rabbitmq/src/driver.ts` and its test suite,
[`packages/rabbitmq/test/driver.test.ts`](../../rabbitmq/test/driver.test.ts), are the reference
implementation for a `BrokerQueueDriver` — connection lifecycle, lazy connect-on-first-use, ack/nack
policy, and the contract suite wiring all live there. Read them alongside this guide rather than
starting from a blank file.

The contract suite covers, among other cases: enqueuing before any worker exists, `work()` returning a
`QueueWorker`, graceful vs. forced `close()`, and — for broker drivers — at-least-once redelivery after
a simulated crash. If your driver passes it, `core` will treat it correctly regardless of what broker
sits behind it.
