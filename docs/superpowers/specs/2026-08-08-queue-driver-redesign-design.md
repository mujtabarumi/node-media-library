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

### 6. Environment-driven selection: a documented pattern, not an API

Selecting a backend by environment variable is a README example, not a shipped helper:

```ts
function resolveQueue() {
  switch (process.env.MEDIA_QUEUE ?? 'sync') {
    case 'sync':
      return syncDriver()
    case 'bullmq':
      return bullmqDriver({ connection: redis })
    case 'rabbitmq':
      return rabbitmqDriver({ connection: amqp })
    default:
      throw new Error(`unknown MEDIA_QUEUE: ${process.env.MEDIA_QUEUE}`)
  }
}
```

An earlier draft of this spec proposed shipping a `selectQueueDriver(name, factoryMap)` helper. It is
dropped. No comparable library ships one — Keyv, Auth.js, and Vite all leave backend selection to the
caller — because it is a five-line `Record<string, () => T>` lookup that would become permanent public
API.

The hazard that justified it was real but misattributed. A hand-rolled ternary that falls through to
`syncDriver()` on a typo'd environment variable produces no error, only heavy image conversion running
inline inside HTTP requests. The ecosystem's answer to that is **fail-fast environment validation at
boot** (`envalid`, `zod`, `t3-env`) — which is the host application's responsibility, and which fixes
every environment variable rather than this one. A helper in core would solve it for `MEDIA_QUEUE`
while the app's other variables stayed unchecked.

What core owes here is the `default: throw` in the documented example, and a README note pointing at
environment validation.

### 7. `@node-media-library/rabbitmq`

A new package implementing `BrokerQueueDriver` over `amqplib`, following standard AMQP practice:

```ts
// `url` and `connection` are mutually exclusive; exactly one is required.
rabbitmqDriver({ url: string } | ({ connection: AmqpLikeConnection } & SharedOptions))

interface SharedOptions {
  queueName?: string
  prefetch?: number
  deadLetterExchange?: string
}
```

When given a `url` the driver owns the connection and closes it on `close()`. When given a
`connection` the host app owns it, and `close()` closes only the channels the driver opened — closing
a connection the driver did not create would break every other consumer sharing it.

- **Producer:** `assertQueue(name, { durable: true })`, publish with `persistent: true`. Durability
  and persistence must be paired — a durable queue holding non-persistent messages still loses them
  on broker restart.
- **Consumer:** a separate channel, `prefetch(n)` derived from `WorkOptions.concurrency`, manual ack.
  Processor resolves → `ack`. Processor rejects → `nack(msg, false, false)`, which dead-letters
  rather than requeue-looping a poison message indefinitely.
- **Retry and DLQ stay RabbitMQ-native.** The adapter exposes `deadLetterExchange` and otherwise gets
  out of the way. Ack/nack/retry/DLQ deliberately do **not** appear in the core interface — they are
  driver policy, and the broker implements them better than we would.
- **Bring-your-own connection, structurally typed.** Options accept either a `url` or an existing
  connection satisfying a minimal `AmqpLikeConnection` interface — `createChannel()` and `close()`,
  nothing more. This mirrors `packages/prisma`'s existing `PrismaLikeClient` duck typing rather than
  inventing a second convention, and it matches how adapters across the ecosystem accept a client
  they did not create (BullMQ takes an ioredis instance, `connect-redis` takes a client, Kysely
  dialects take a pool).

  What it buys is sharing one connection across several consumers in a process, and accepting an
  in-house wrapper or pool — such as `@ordaroo/queue` — without the adapter needing to know its
  concrete shape. The bar is narrow but real: `createChannel()` must **resolve to** an amqplib
  `Channel`, because that is the object the adapter calls
  `assertQueue`/`prefetch`/`consume`/`ack`/`nack`/`cancel` on.

  **Correction (final review).** An earlier draft of this section justified structural typing by
  saying amqplib does not auto-reconnect, that `amqp-connection-manager` is the ecosystem answer, and
  that a structural type therefore lets the host app hand us its managed connection instead of us
  reimplementing reconnection. The first clause is true; the conclusion is not. Verified against
  `amqp-connection-manager@5` (current `latest`): `createChannel(options?)` is **synchronous** and
  returns a `ChannelWrapper` — an `addSetup`-callback reconnect abstraction — not a
  `Promise<amqplib.Channel>`. It fails `AmqpLikeConnection` on both the sync/async mismatch and the
  return type, so no amount of structural typing makes it fit; bridging the two models would take a
  real adapter, not a cast.

  Structural typing still earns its place for the bring-your-own-connection cases above. But
  **amqplib's lack of auto-reconnect remains unsolved for this adapter** — a caveat we ship, not a
  problem this design solved. `packages/rabbitmq/README.md` documents it under "Known limitations":
  reconnection is the caller's problem, and the practical answer is to run the worker under a
  supervisor and let it exit on a dropped connection.

- **Dependencies:** `amqplib` as a peer dependency, `@node-media-library/core` as the only runtime
  dependency, matching the bullmq package's shape.

### 8. Contract suite and docs

`runQueueDriverContract` splits into in-process and broker variants. The broker variant adds cases for
`work()` lifecycle and graceful versus forced close. The RabbitMQ suite gates on `AMQP_URL` exactly as
the BullMQ suite gates on `REDIS_URL`; CI gains a rabbitmq service container.

**Not shipped: an at-least-once redelivery case.** This section originally listed one. Simulating the
crash that causes redelivery portably — kill the consumer between the processor's side effects and the
ack, then assert the next consumer sees the message again — means driving each broker's own
recovery machinery (RabbitMQ redelivers on channel loss immediately; BullMQ only after its stalled-job
checker fires, on a timescale measured in tens of seconds). A shared contract case would have to be
written to the slowest of those, and would be testing the broker rather than the driver. At-least-once
therefore stays a documented guarantee that processors must assume — see the "Delivery is
at-least-once" section of `packages/core/docs/writing-a-queue-driver.md` — not an asserted one.

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
