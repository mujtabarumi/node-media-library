# Queue driver redesign

**Date:** 2026-08-08
**Status:** Decided
**Scope:** The `QueueDriver` contract, how conversions are consumed, and what it takes to run this
library against a queue backend we don't ship. Breaking, pre-1.0.

The companion schema/install work (canonical SQL migrations, logical schema spec, `init` copier) is a
**separate spec** and is not designed here — see [Deferred](#deferred-to-the-schema-spec).

## Decision

Split `QueueDriver` by deployment model — in-process versus broker-backed — so that constructing a
`MediaLibrary` can never make a web process a broker consumer. Add an explicit worker entrypoint
(`startWorker()` plus a `worker` CLI command), pin `close()` semantics in the shared contract suite,
and ship a first-party RabbitMQ adapter as the reference implementation for the driver-authoring
guide.

Explicitly **not** building: a core-owned string registry that maps `'bullmq' | 'rabbitmq'` to a
lazily imported adapter.

## Context

A user adopting the library into an existing production app reported two friction points. The second
was queue-shaped: the repo ships a BullMQ (Redis) adapter, their infrastructure is RabbitMQ behind an
in-house `@ordaroo/queue` package and a `QueueRegistry`. Core does expose a `QueueDriver` interface,
so this is an adapter rather than a fork — but writing it still meant a contracts entry, a worker
job, and a driver, with no reference implementation and no documented contract to work from.

Their proposed fix was a config or environment key selecting the queue backend, so a project could
switch between BullMQ and RabbitMQ without hand-wiring a driver object.

## The defect this uncovered

`MediaLibrary`'s constructor calls `this.resolved.queue.registerProcessor(...)` unconditionally
([`packages/core/src/library.ts:70`](../../../packages/core/src/library.ts)). The BullMQ driver's
`registerProcessor` constructs a `new Worker(...)`
([`packages/bullmq/src/driver.ts:66`](../../../packages/bullmq/src/driver.ts)).

The consequence: **every process that constructs a `MediaLibrary` with `bullmqDriver` becomes a Redis
consumer.** A Next.js API route, a serverless handler, or a one-off script silently starts pulling
conversion jobs — running sharp, spawning ffmpeg — inside a web dyno sized for HTTP. The driver's own
JSDoc claims instances are created lazily "so constructing the driver never touches Redis"; core's
wiring defeats that claim.

This is the real architectural problem behind the reported friction, and it is why the interface —
not the selection mechanism — is what changes.

## Design

### 1. Split the interface by deployment model

The bug is not that core attaches a processor at construction. It is that core attaches a processor
to a _remote broker_ at construction. An in-process driver attaching eagerly is correct — that is its
entire purpose. So the two cases become distinct types, discriminated structurally:

```ts
export interface QueueDriver {
  enqueue(job: ConversionJob): Promise<void>
  close(): Promise<void>
}

/**
 * Consumes in the same process that produces. Core attaches its processor at
 * construction — there is no separate worker process.
 */
export interface InProcessQueueDriver extends QueueDriver {
  attach(processor: ConversionProcessor): void
}

/**
 * Backed by an external broker. Consuming requires an explicit startWorker()
 * in a dedicated process.
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
```

`syncDriver` and `deferDriver` become `InProcessQueueDriver`s: `registerProcessor` is renamed
`attach`, with dispatch behavior unchanged. `deferDriver`'s `close()` does change — see
[shutdown semantics](#3-shutdown-semantics-pinned-by-contract). `bullmqDriver` becomes a
`BrokerQueueDriver`.

No boolean flag distinguishes them. `'attach' in driver` is the discriminator, and the type names
document the deployment model at the point of use.

`MediaLibraryConfig.queue` is typed `InProcessQueueDriver | BrokerQueueDriver`, not the bare
`QueueDriver` base. The base type describes what both kinds share; it is not itself configurable,
since a driver that can neither attach nor work can only ever enqueue jobs nothing consumes.

### 2. Core wiring

The constructor becomes conditional:

```ts
if ('attach' in this.resolved.queue) {
  this.resolved.queue.attach((job) => this.engine.perform(job.mediaId, job.conversionNames))
}
```

A broker driver receives nothing at construction. A web process holding a `MediaLibrary` is therefore
a **pure producer by construction** — the defect is removed structurally, not by a guard a caller
could forget.

`MediaLibrary` gains:

```ts
startWorker(opts?: WorkOptions): Promise<QueueWorker>
```

It calls `driver.work(processor, opts)`. When the configured driver has no `work()`, it throws a
`MediaLibraryError` naming the cause: an in-process driver runs conversions inline, so no worker is
needed.

The `generation` counter and the fire-and-forget `oldWorker.close().finally(createWorker)` chain in
the BullMQ driver are both deleted. They exist only because `registerProcessor(): void` cannot
express asynchronous worker lifecycle; `work()` returning a promise expresses it natively.

### 3. Shutdown semantics, pinned by contract

Currently `deferDriver`'s JSDoc documents that `close()` resolves while scheduled work is still
pending. That honesty note becomes a tested guarantee instead of a caveat:

- `QueueWorker.close()` stops accepting new jobs and resolves once in-flight jobs settle.
- `QueueWorker.close({ force: true })` abandons in-flight jobs.
- `QueueDriver.close()` releases producer resources and closes any workers it created that remain
  open.
- `deferDriver` drains its scheduled `setImmediate` callbacks before `close()` resolves.

Without this, a SIGTERM during a rolling deploy silently drops conversions.

### 4. Worker entrypoint

The programmatic API is primary:

```ts
const worker = await media.startWorker({ concurrency: 4 })
process.on('SIGTERM', () => worker.close())
```

A CLI command is added as a convenience, because this repo already ships a CLI that loads a config
module — having `regenerate` and `clean` but requiring a hand-rolled worker would be inconsistent:

```
node-media-library worker --config ./medialibrary.config.ts [--concurrency n] [--shutdown-timeout s]
```

It traps `SIGTERM`/`SIGINT`, calls `worker.close()`, then `driver.close()`, and force-closes after
`--shutdown-timeout` (default 30s) before exiting. The timeout is not optional politeness: Kubernetes
sends `SIGTERM` and then `SIGKILL` after a grace period, so an unbounded drain is killed mid-job
anyway.

Concurrency moves from driver construction to `work(fn, { concurrency })`, mirroring BullMQ's own
`new Worker(name, fn, { concurrency })`. `bullmqDriver`'s existing `workerConcurrency` option remains
as the driver-level default, overridden by `WorkOptions.concurrency`.

### 5. Config file convention

When `--config` is omitted, the CLI resolves `medialibrary.config.{ts,mts,js,mjs}` from the current
working directory. `--config` remains the explicit override. This matches JS ecosystem convention
(`vitest.config.ts`, `drizzle.config.ts`, `playwright.config.ts`, `eslint.config.js`).

The module still default-exports a live `MediaLibrary` instance rather than a plain config object.
That is unusual for a `*.config.*` file, but correct here: the configuration legitimately holds live
objects — a Prisma client, a queue driver, image generators. The existing `.ts`-needs-a-loader hint in
`defaultLoadLibrary` continues to apply.

### 6. `selectQueueDriver`

A small helper for environment-driven selection over a **user-supplied** factory map:

```ts
queue: selectQueueDriver(process.env.MEDIA_QUEUE ?? 'sync', {
  sync: () => syncDriver(),
  bullmq: () => bullmqDriver({ connection: redis }),
  rabbitmq: () => rabbitmqDriver({ url: process.env.AMQP_URL! }),
  ordaroo: () => ordarooDriver(queueRegistry),
})
```

Core never imports an adapter; the map belongs to the caller, so an in-house driver is a first-class
entry beside the first-party ones. Only the selected factory runs, so an unused backend's connection
is never opened.

It is generic over the map's value types, so the return type is the union of what the factories
actually produce — a map of only in-process factories yields `InProcessQueueDriver`, and a mixed map
yields the union that `MediaLibraryConfig.queue` accepts. Selection is by string, so the result is a
union rather than a single known driver; a caller needing `startWorker()` unconditionally should
construct that driver directly instead.

Its one substantive justification is failing loud. A hand-rolled ternary falls through to
`syncDriver()` on a typo'd environment variable, and the symptom is not an error — it is heavy image
conversion running inline inside HTTP requests. `selectQueueDriver` throws a `MediaLibraryError`
naming the unknown value and listing the valid keys.

### 7. `@node-media-library/rabbitmq`

A new package implementing `BrokerQueueDriver` over `amqplib`, following standard AMQP practice:

```ts
rabbitmqDriver({ url, connection?, queueName?, prefetch?, deadLetterExchange? })
```

- **Producer:** `assertQueue(name, { durable: true })`, publish with `persistent: true`. Durability
  and persistence must be paired — a durable queue holding non-persistent messages still loses them
  on broker restart.
- **Consumer:** a separate channel, `prefetch(n)` derived from `WorkOptions.concurrency`, manual ack.
  Processor resolves → `ack`. Processor rejects → `nack(msg, false, false)`, which dead-letters
  rather than requeue-looping a poison message indefinitely.
- **Retry and DLQ stay RabbitMQ-native.** The adapter exposes `deadLetterExchange` and otherwise gets
  out of the way. Ack/nack/retry/DLQ deliberately do **not** appear in the core interface — they are
  driver policy, and the broker implements them better than we would.
- **Bring-your-own connection.** Options accept either a `url` or an existing amqplib connection,
  mirroring how `bullmqDriver` accepts an ioredis instance. This matters because amqplib does not
  auto-reconnect; the ecosystem answer is `amqp-connection-manager`. Rather than reimplementing
  reconnection, the host app passes its managed connection — which is precisely how an in-house
  wrapper such as `@ordaroo/queue` plugs in.
- **Dependencies:** `amqplib` as a peer dependency, `@node-media-library/core` as the only runtime
  dependency, matching the bullmq package's shape.

### 8. Contract suite and docs

`runQueueDriverContract` splits into in-process and broker variants. The broker variant adds cases for
`work()` lifecycle, graceful versus forced close, and at-least-once redelivery. The RabbitMQ suite
gates on `AMQP_URL` exactly as the BullMQ suite gates on `REDIS_URL`; CI gains a rabbitmq service
container.

A "Writing a queue driver" guide is added, anchored on the exported contract suite — the artifact that
would have served the reporting user directly. It documents the delivery guarantee explicitly:
**at-least-once, so processors must be idempotent.** `markConversionGenerated` and
`mergeResponsiveImages` are merge-based rather than replace-based, so redelivery is already safe; the
guide says so rather than leaving implementers to infer it.

## Options considered

### Core-owned string registry (rejected)

The literal request: `queue: { driver: 'rabbitmq', options: {...} }`, with core dynamic-importing the
first-party adapter.

Rejected on three grounds. Core cannot take a hard dependency on `bullmq` or `amqplib`, so selection
becomes `import('@node-media-library/bullmq')` behind a string — and bundlers (Next, esbuild,
serverless packagers) either fail to resolve optional dependencies or eagerly include them. Typed
per-driver options force core to know every adapter's option shape, inverting the repo's rule that
adapters depend on core and never the reverse. Most decisively, a registry cannot cover the reporting
user's actual case: no list we ship will ever contain their in-house driver. The registry serves
people already served by three lines of user code, and fails the people who filed the report.

### Registry with an escape hatch (rejected)

Accepting both a string form and an object form. This keeps custom drivers working, but preserves the
bundler risk while adding a permanent second code path and a union type on the config field.

### Fix the constructor bug only, keep the interface (rejected)

The smallest diff: make processor registration opt-in without splitting the type. Rejected because a
RabbitMQ adapter would then be written against an interface that does not fit it — one object
conflating producer and consumer, with `registerProcessor(): void` unable to express channel setup —
and 1.0's compatibility promise would freeze that shape.

### Defer queue work entirely (rejected)

Ship the schema work first. Rejected because the defect ships with it, and the cost of breaking the
interface rises every week after npm publication.

## Rationale

**The producer/consumer split is universal in Node queue libraries.** BullMQ ships `Queue` and
`Worker` as separate classes. pg-boss has `send()` and `work()`. kafkajs has `client.producer()` and
`client.consumer()`. amqplib uses separate channels per role. Cloud SDKs ship separate publisher and
subscriber clients. The current single-object interface is the outlier, and the codebase already pays
for it in the BullMQ driver's generation counter.

**Object injection is the library convention; string registries are the framework convention.**
Laravel's `QUEUE_CONNECTION=redis` and Rails' `queue_adapter = :sidekiq` work because those frameworks
own application bootstrap and a DI container, and because there is no bundler tree-shaking the
unselected branch. Node libraries pass the object: Keyv takes a store instance, Passport takes a
strategy instance, Auth.js takes an adapter instance. This project is a library and does not own the
host app's bootstrap, so it cannot own its dependency graph either.

**Graceful shutdown is table stakes.** BullMQ's `worker.close()` waits for active jobs, pg-boss has
`stop({ graceful, timeout })`, kafkajs finishes in-flight batches on disconnect. Defining the same
guarantee here is matching the field, not innovating.

**Nothing is published to npm**, so the blast radius of the break is the examples, the tests, and the
docs in this repo.

## Consequences

- Breaking change to `QueueDriver`. In-repo consumers to update: `packages/core/src/library.ts`,
  `packages/core/src/config.ts`, `packages/core/src/pipeline/file-adder.ts`,
  `packages/core/src/queue.ts`, `packages/core/src/testing/queue-contract.ts`,
  `packages/bullmq/src/driver.ts`, and the core and bullmq test suites.
- A new published package, `@node-media-library/rabbitmq`, with the dual export map and `prepack`
  guard every package carries.
- CI gains a rabbitmq service container, and the matrix grows accordingly.
- Deployment topology becomes explicit: running conversions on a broker now requires a worker process
  that someone must actually start. This is a documentation obligation — the failure mode of the new
  design is "conversions never run," which is loud, versus the old design's "conversions run in the
  web process," which is silent.
- `docs/superpowers/specs/2026-07-26-node-media-library-design.md`, the core README, and the bullmq
  README all describe the current queue contract and must be updated in the same PR, per the repo's
  docs-match-behavior rule.
- A changeset is required: breaking core change plus a new package.

## Deferred to the schema spec

Decided in the same conversation, recorded here so the follow-up brainstorm starts from them rather
than relitigating:

- Canonical schema artifact becomes **versioned raw SQL** (`0001_init.up.sql` / `0001_init.down.sql`)
  shipped in the package `files`, not a Prisma model string. Laravel ships a migration, not an
  Eloquent model, and `MediaRepository` is already ORM-agnostic.
- **Postgres, MySQL, and SQLite**, plus a written logical schema specification (column semantics,
  nullability, indexes) that ORM adapters and community backends conform to.
- The **host application always owns the migration runner.** We ship `down.sql` and never execute it.
  No library-owned migration-history table.
- Schema evolution is additive numbered files forever.
- `MEDIA_MODEL_SNIPPET` demotes to a derived convenience, asserted against the SQL by tests.
- An `init` copier that prompts for dialect and ORM and copies templates. No stack auto-detection, no
  parsing or editing of a user's `schema.prisma`.

## Out of scope

- Additional ORM repository adapters (Drizzle, Kysely, TypeORM). The contract suite already makes
  community adapters viable; first-party ones do not address the reported friction.
- Ack/nack/retry/DLQ surface area in the core `QueueDriver` interface.
- A `doctor` command that introspects a live table for schema drift. Worth building; not blocking.
