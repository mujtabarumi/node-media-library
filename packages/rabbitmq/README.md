# @node-media-library/rabbitmq

RabbitMQ (amqplib) queue driver for `@node-media-library/core`. Pre-release: not yet published to npm.

## Install

Once published: `npm install @node-media-library/rabbitmq amqplib`
`amqplib` (`^0.10`) is a required peer dependency.

TypeScript consumers also need `npm install -D @types/amqplib`. `amqplib` ships no bundled types, and
this package's exported `AmqpLikeConnection` type references `amqplib`'s `Channel` — without
`@types/amqplib` installed, TypeScript reports an unresolved module when it reads our `.d.ts`.

## Usage

Wire it into `createMediaLibrary` via the `queue` option. Two mutually exclusive option shapes are
accepted — pass exactly one:

```ts
import { createMediaLibrary } from '@node-media-library/core'
import { rabbitmqDriver } from '@node-media-library/rabbitmq'

const media = createMediaLibrary({
  repository,
  storage: { disks: { default: { driver: 'fs', root: './storage' } } },
  models: { User: {} },
  queue: rabbitmqDriver({ url: process.env.AMQP_URL! }),
})
```

- **`url`** — the driver opens its own connection on first `enqueue`/`work` call and closes it on
  `close()`.
- **`connection`** — pass an already-open connection you own, or any structurally compatible wrapper
  (an in-house wrapper, a connection pool) whose `createChannel()` and `createConfirmChannel()`
  **resolve to** amqplib `Channel`/`ConfirmChannel` objects. Both are required: producing uses a
  confirm channel (see "Delivery guarantee"), consuming a plain one. The driver only ever closes the
  channels it created; `close()` never touches a connection it didn't open, so tearing down a
  `MediaLibrary` never breaks other consumers sharing that connection in the same process.

The connection/channel are created lazily on first `enqueue`/`work` call, so constructing the driver
never touches RabbitMQ. Setup is memoized on the in-flight promise, not the resolved handle, so
concurrent first calls — two parallel requests on a cold web process both reaching `enqueue()` —
share one connection and one producer channel rather than each opening their own. A connect that
fails is not cached: the next call tries again.

## Worker process

`rabbitmqDriver` is a `BrokerQueueDriver`: constructing a `MediaLibrary` with it never starts consuming
— only producing (`enqueue`) works out of the box. Consuming requires an explicit `startWorker()` call,
made from a dedicated process with the _same_ config, kept alive:

```ts
// worker.ts
import { createMediaLibrary } from '@node-media-library/core'
import { rabbitmqDriver } from '@node-media-library/rabbitmq'

const media = createMediaLibrary({
  repository,
  storage: { disks: { default: { driver: 'fs', root: './storage' } } },
  models: { User: {} },
  queue: rabbitmqDriver({ url: process.env.AMQP_URL! }),
})

const worker = await media.startWorker({ concurrency: 4 })
process.on('SIGTERM', () => worker.close()) // waits for in-flight jobs; { force: true } to abandon them
// keep the process alive; the worker above processes jobs until closed.
```

Or via the CLI, given a `medialibrary.config.ts` that default-exports the same configuration:

```bash
node-media-library worker --config medialibrary.config.ts --concurrency 4
```

## Delivery guarantee

Delivery is **at-least-once**, on both sides of the queue.

**Producing.** `enqueue()` publishes on a **confirm channel** and resolves only once the broker has
acknowledged the message. On a plain channel `sendToQueue()` is fire-and-forget, so an awaited
`enqueue()` would mean no more than "the bytes reached a socket buffer" — and a connection drop
between that and the broker would lose the job silently, which the `durable: true` queue and
`persistent: true` messages read as a promise not to. If the broker `nack`s the publish, `enqueue()`
rejects with a `MediaLibraryError`. Awaiting the confirm doubles as the backpressure wait: the
broker cannot confirm a message it has not received, so a caller awaiting `enqueue()` is already
waiting for the write buffer to flush.

**Consuming.** A job is acked only after the processor resolves; if the process crashes mid-job, or
the processor throws, the message is not lost — but a crash after the processor's side effects landed
and before the ack reaches the broker can cause the same job to be redelivered. **Processors must be
idempotent**: re-running a conversion job for the same media and conversion names must be safe to
repeat.

A processor that rejects has its message `nack`'d without requeue (`nack(msg, false, false)`), so a
poison message is dead-lettered (or dropped) rather than looping redelivery forever. Retry policy —
how many times, with what backoff, whether to alert — is intentionally left to the broker/exchange
topology, not built into this driver.

**Message size.** A consumed body larger than **64 KiB** is `nack`'d without requeue before it is
parsed, and reported through `onError`. A `ConversionJob` is a media id and a few conversion names,
so anything near that ceiling is malformed by definition; RabbitMQ's own server-side
`max_message_size` defaults to 128 MB and `prefetch` multiplies it. The limit is not configurable.

## Error handling

The connection and every channel this driver opens get an `'error'` listener attached. That is not
optional politeness: amqplib's connection and channels are Node `EventEmitter`s, an async broker
failure (a restart, a dropped TCP connection, a `PRECONDITION_FAILED`, an ack against an unknown
delivery tag) emits `'error'` outside any `await`, and **Node throws on an unhandled `'error'`
event** — so with no listener it is an uncaught exception, in the web process as much as the worker.
A `try/catch` around the consumer does not cover it: on a `ChannelClose` frame amqplib queues the
promise rejection as a microtask and emits `'error'` synchronously in the same stack, so the throw
escapes first.

Pass `onError` to route those errors into your own logger — or to exit deliberately:

```ts
rabbitmqDriver({
  url: process.env.AMQP_URL!,
  onError: (err) => {
    logger.error({ err }, 'rabbitmq driver error')
    // The driver does not reconnect. Under a supervisor, exiting here is the
    // reconnect strategy.
    process.exit(1)
  },
})
```

Without `onError` the errors are reported with `console.error` — never swallowed. Teardown failures
land here too: a `cancel()`/`close()` against a channel the broker already tore down is reported
rather than rejecting `close()`, so a shutdown _after_ a lost connection — the most likely reason
you are shutting down — still completes instead of exiting the worker CLI non-zero.

## Known limitations

**Reconnection is your problem.** `amqplib` does not reconnect on its own, and neither does this
driver: if the broker or the TCP connection goes away, the channels this driver opened are dead and
the worker stops consuming. Nothing here retries the connect. (One narrow exception: a _failed_
initial connect is not memoized, so a later `enqueue()`/`work()` will try to connect again. That is
not reconnection — an already-established connection that drops is not re-established.)

The obvious escape hatch does not fit either — `amqp-connection-manager`, the usual ecosystem answer
for managed AMQP connections, is **not** compatible with the `connection` option. Its `createChannel()`
is synchronous and returns a `ChannelWrapper` (a reconnect abstraction driven by `addSetup` callbacks),
whereas `AmqpLikeConnection` requires a `createChannel()` that resolves to a real amqplib `Channel`.
The two models are different enough that adapting one to the other is not a type cast. So:

- Under a supervisor (Kubernetes, systemd, PM2, Nomad), the practical answer is to let the process
  exit and be restarted — from `onError`, which fires for the connection the driver opened as well as
  for one you passed in. (Earlier revisions of this file told you to watch the connection yourself;
  with the `url` option the driver owns the connection and never hands it back, so that advice was
  unactionable for the common case. `onError` is the actionable version.)
- The `connection` option is still useful for sharing one connection across several consumers in a
  process, and for in-house wrappers/pools that hand back real amqplib channels.

**`driver.close()` drains unboundedly.** It waits for every in-flight job to settle with no timeout,
so a wedged processor hangs shutdown forever. The `worker` CLI bounds this with `--shutdown-timeout`
(force-closing when it elapses); a programmatic caller with its own SIGTERM handling should race
`close()` against its own timer and fall back to `worker.close({ force: true })`.

## Options

`rabbitmqDriver({ url, connection, queueName, prefetch, deadLetterExchange, onError })`:

- `url` / `connection` — mutually exclusive; exactly one is required. See "Usage" above.
- `queueName` — defaults to `'media-conversions'`.
- `prefetch` — default unacked-message window per worker (BullMQ calls this concurrency); overridden
  per-call by `WorkOptions.concurrency`. Defaults to `2`.
- `deadLetterExchange` — exchange name that rejected messages are routed to. Omit to let RabbitMQ drop
  them per the queue's default behavior. Setting this up (the exchange, its bindings, any retry/delay
  logic) is the caller's responsibility — this driver only sets the `x-dead-letter-exchange` queue
  argument when asserting the queue.
- `onError` — called for every `'error'` event from the connection or this driver's channels, for
  teardown failures against an already-closed channel, and for messages rejected over the size
  ceiling. Defaults to `console.error`. See "Error handling" above. (`@node-media-library/bullmq`
  takes the same option with the same shape.)

## Tests

The contract suite (`test/driver.test.ts`) is AMQP-gated: set `AMQP_URL` to run it against a real
broker, e.g. `AMQP_URL=amqp://guest:guest@localhost:5672 npx vitest run`. Without `AMQP_URL` it skips
with a printed warning, and separate unconditional tests confirm construction never touches RabbitMQ,
that missing both `url` and `connection` throws synchronously, that `work()` rejects after `close()`
without connecting, that a caller-supplied `connection` is never closed by this driver, that an
oversized message is rejected unparsed, and that teardown against an already-closed channel still
resolves.

`test/lazy-setup.test.ts` is ungated and stubs the `amqplib` module itself. It covers what a real
broker cannot report: how many connections and channels the driver opened, whether `close()` reaches
one still being opened, and whether an emitted `'error'` reaches `onError` instead of the process.
