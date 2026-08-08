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
  (an in-house wrapper, a connection pool) whose `createChannel()` **resolves to** an amqplib
  `Channel`. The driver only ever closes the channels it created; `close()` never touches a connection
  it didn't open, so tearing down a `MediaLibrary` never breaks other consumers sharing that
  connection in the same process.

The connection/channel are created lazily on first `enqueue`/`work` call, so constructing the driver
never touches RabbitMQ.

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

Delivery is **at-least-once**. A job is acked only after the processor resolves; if the process
crashes mid-job, or the processor throws, the message is not silently lost — but a crash after the
processor's side effects landed and before the ack reaches the broker can cause the same job to be
redelivered. **Processors must be idempotent**: re-running a conversion job for the same media and
conversion names must be safe to repeat.

A processor that rejects has its message `nack`'d without requeue (`nack(msg, false, false)`), so a
poison message is dead-lettered (or dropped) rather than looping redelivery forever. Retry policy —
how many times, with what backoff, whether to alert — is intentionally left to the broker/exchange
topology, not built into this driver.

## Known limitations

**Reconnection is your problem.** `amqplib` does not reconnect on its own, and neither does this
driver: if the broker or the TCP connection goes away, the channels this driver opened are dead and
the worker stops consuming. Nothing here retries the connect.

The obvious escape hatch does not fit either — `amqp-connection-manager`, the usual ecosystem answer
for managed AMQP connections, is **not** compatible with the `connection` option. Its `createChannel()`
is synchronous and returns a `ChannelWrapper` (a reconnect abstraction driven by `addSetup` callbacks),
whereas `AmqpLikeConnection` requires a `createChannel()` that resolves to a real amqplib `Channel`.
The two models are different enough that adapting one to the other is not a type cast. So:

- Under a supervisor (Kubernetes, systemd, PM2, Nomad), the practical answer is to let the process
  exit and be restarted. Watch the connection yourself and exit non-zero on `'close'`/`'error'`.
- The `connection` option is still useful for sharing one connection across several consumers in a
  process, and for in-house wrappers/pools that hand back real amqplib channels.

**`driver.close()` drains unboundedly.** It waits for every in-flight job to settle with no timeout,
so a wedged processor hangs shutdown forever. The `worker` CLI bounds this with `--shutdown-timeout`
(force-closing when it elapses); a programmatic caller with its own SIGTERM handling should race
`close()` against its own timer and fall back to `worker.close({ force: true })`.

## Options

`rabbitmqDriver({ url, connection, queueName, prefetch, deadLetterExchange })`:

- `url` / `connection` — mutually exclusive; exactly one is required. See "Usage" above.
- `queueName` — defaults to `'media-conversions'`.
- `prefetch` — default unacked-message window per worker (BullMQ calls this concurrency); overridden
  per-call by `WorkOptions.concurrency`. Defaults to `2`.
- `deadLetterExchange` — exchange name that rejected messages are routed to. Omit to let RabbitMQ drop
  them per the queue's default behavior. Setting this up (the exchange, its bindings, any retry/delay
  logic) is the caller's responsibility — this driver only sets the `x-dead-letter-exchange` queue
  argument when asserting the queue.

## Tests

The contract suite (`test/driver.test.ts`) is AMQP-gated: set `AMQP_URL` to run it against a real
broker, e.g. `AMQP_URL=amqp://guest:guest@localhost:5672 npx vitest run`. Without `AMQP_URL` it skips
with a printed warning, and separate unconditional tests confirm construction never touches RabbitMQ,
that missing both `url` and `connection` throws synchronously, that `work()` rejects after `close()`
without connecting, and that a caller-supplied `connection` is never closed by this driver.
