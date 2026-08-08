---
title: Packages
description: The packages, what each needs, and every option they take.
---

Each package is independently publishable and depends only on `@node-media-library/core` — never on a
sibling. Install what you use.

| Package                          | What it's for                                            |
| -------------------------------- | -------------------------------------------------------- |
| `@node-media-library/core`       | The engine. Storage, collections, conversions, CLI.      |
| `@node-media-library/prisma`     | `MediaRepository` backed by Prisma, plus cascade delete. |
| `@node-media-library/bullmq`     | `BrokerQueueDriver` dispatching conversions to BullMQ.   |
| `@node-media-library/rabbitmq`   | `BrokerQueueDriver` dispatching conversions to RabbitMQ. |
| `@node-media-library/pdf`        | `ImageGenerator` rasterising PDF pages.                  |
| `@node-media-library/video`      | `ImageGenerator` extracting video frames.                |
| `@node-media-library/optimizers` | `jpegoptim`/`pngquant` optimizers for derived files.     |

## Nothing auto-registers

Installing a package enables nothing. Each has to be wired into `createMediaLibrary()`:

| Package      | Wired in via                                    |
| ------------ | ----------------------------------------------- |
| `prisma`     | `repository: prismaAdapter(prisma)`             |
| `bullmq`     | `queue: bullmqDriver({ connection })`           |
| `rabbitmq`   | `queue: rabbitmqDriver({ url })`                |
| `pdf`        | `imageGenerators: [..., pdfImageGenerator()]`   |
| `video`      | `imageGenerators: [..., videoImageGenerator()]` |
| `optimizers` | `optimizers: [jpegoptimOptimizer()]`            |

The upside is that a config file tells you exactly what will happen to an upload, with no hidden
discovery step. The downside is that "I installed it and nothing changed" is a real experience — this
is the reason.

`bullmq` and `rabbitmq` are both `BrokerQueueDriver`s: constructing `MediaLibrary` with either one only
enables producing (`enqueue`). Consuming needs an explicit `await media.startWorker()` call, or the
`worker` CLI command — see [background conversions](/guides/background-conversions/).

## Peer dependencies

| Package    | Peer                    | Required?                                     |
| ---------- | ----------------------- | --------------------------------------------- |
| `core`     | `@google-cloud/storage` | Optional — only for the `gcs` storage driver. |
| `prisma`   | `@prisma/client`        | Optional — bring your own (`>=6.2 <8`).       |
| `bullmq`   | `bullmq`                | Required (`^5 \|\| ^6`).                      |
| `rabbitmq` | `amqplib`               | Required (`^0.10`).                           |

## System binaries

Not bundled. Each package degrades rather than crashing when its binary is absent: the optimizers
become no-ops, and the generators simply don't claim their MIME types, so uploads still succeed without
thumbnails.

| Package      | Binary                  | macOS                             | Debian/Ubuntu                    |
| ------------ | ----------------------- | --------------------------------- | -------------------------------- |
| `pdf`        | `pdftoppm` (poppler)    | `brew install poppler`            | `apt install poppler-utils`      |
| `video`      | `ffmpeg`                | `brew install ffmpeg`             | `apt install ffmpeg`             |
| `optimizers` | `jpegoptim`, `pngquant` | `brew install jpegoptim pngquant` | `apt install jpegoptim pngquant` |

## Options

### `prismaAdapter(client, options?)`

| Option             | Default | Meaning                                                                     |
| ------------------ | ------- | --------------------------------------------------------------------------- |
| `owners`           | —       | `modelType → (modelId) => boolean`. Only used by `clean --delete-orphaned`. |
| `iterateBatchSize` | `100`   | Page size for `iterateAll()`, used by `regenerate` and `clean`.             |

Also exports `withMediaCascade(client, library, { models? })` and `MEDIA_MODEL_SNIPPET`. See
[persistence with Prisma](/production/prisma/).

### `bullmqDriver(options)`

| Option              | Default               | Meaning                                                                              |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `connection`        | — (required)          | ioredis options, an `{ url }` object, or an instance.                                |
| `queueName`         | `'media-conversions'` | BullMQ queue name.                                                                   |
| `workerConcurrency` | `2`                   | Default `Worker` concurrency, overridden per call by `startWorker({ concurrency })`. |

See [background conversions](/guides/background-conversions/).

### `rabbitmqDriver(options)`

`url` and `connection` are mutually exclusive — pass exactly one.

| Option               | Default                         | Meaning                                                                                                                                  |
| -------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `url`                | — (required if no `connection`) | AMQP connection string; the driver opens and owns this connection.                                                                       |
| `connection`         | — (required if no `url`)        | An already-open connection you own, or any wrapper whose `createChannel()` resolves to an amqplib `Channel`; the driver never closes it. |
| `queueName`          | `'media-conversions'`           | RabbitMQ queue name.                                                                                                                     |
| `prefetch`           | `2`                             | Default unacked-message window per worker, overridden per call by `startWorker({ concurrency })`.                                        |
| `deadLetterExchange` | — (none)                        | Exchange rejected messages are routed to. Setting up the exchange/bindings is your responsibility.                                       |

Delivery is **at-least-once**: a crash between a processor's side effects and the broker receiving the
ack can redeliver the same job, so processors must be idempotent — see the core package's
[queue driver guide](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/docs/writing-a-queue-driver.md)
for why that's already safe for the shipped conversion pipeline. A processor that rejects has its
message `nack`'d without requeue, so a poison message is dead-lettered (or dropped) rather than looping
forever.

**Reconnection is not handled.** `amqplib` does not reconnect, and neither does this driver — if the
connection drops, the worker stops consuming. `amqp-connection-manager`, the usual ecosystem answer,
is **not** accepted by `connection`: its `createChannel()` is synchronous and returns a
`ChannelWrapper`, not a `Promise<Channel>`. Run the worker under a supervisor and exit non-zero when
the connection closes. See the package's
[Known limitations](https://github.com/mujtabarumi/node-media-library/blob/main/packages/rabbitmq/README.md#known-limitations).

### `pdfImageGenerator(options?)`

| Option         | Default      | Meaning             |
| -------------- | ------------ | ------------------- |
| `pdftoppmPath` | `'pdftoppm'` | Path to the binary. |
| `dpi`          | `150`        | Render resolution.  |

Also exports `pdftoppmAvailable()`.

### `videoImageGenerator(options?)`

| Option       | Default    | Meaning             |
| ------------ | ---------- | ------------------- |
| `ffmpegPath` | `'ffmpeg'` | Path to the binary. |

Also exports `ffmpegAvailable()`. Both generators: see [PDF & video thumbnails](/guides/pdf-video/).

### `jpegoptimOptimizer(options?)` / `pngquantOptimizer(options?)`

| Option          | Default        | Meaning                |
| --------------- | -------------- | ---------------------- |
| `jpegoptimPath` | `'jpegoptim'`  | Path to the binary.    |
| `max`           | `85`           | Quality cap, 0–100.    |
| `pngquantPath`  | `'pngquant'`   | Path to the binary.    |
| `quality`       | pngquant's own | Range, e.g. `'65-90'`. |

## How optimizers actually behave

Worth knowing before you rely on them, because the conditions are narrow.

An optimizer's output is accepted **only if it is strictly smaller** than the buffer it was given.
Larger-or-equal results are discarded. An optimizer that throws is logged with `console.warn` and
skipped — optimization is best-effort and never fails a conversion.

Originals and LQIP placeholders are never passed through an optimizer.

The shipped optimizers key off the resolved format, which is set **only** for conversions declaring an
explicit `.format('jpeg')` or `.format('png')` — plus PDF and video rasterisations, which resolve to
`png`. A conversion left at the keep-original-format default, and responsive variants derived from the
original file, carry no resolved format and pass through **unoptimized**.

So if you add the optimizers and see no size change, check whether your conversions declare a format.

Write your own by implementing `ImageOptimizer`:

```ts
interface ImageOptimizer {
  name: string
  optimize(buffer: Buffer, ctx: OptimizeContext): Promise<Buffer | null>
}
```

Return `null` to pass — the un-optimized buffer is kept.

## Version pinning

Three dependencies are deliberately held back, and dependabot is configured to ignore their majors:

- **`flydrive` stays on `^1`.** 2.x requires Node ≥ 24; this project supports ≥ 22.
- **`@types/node` stays on `^22`.** Types should track the _minimum_ supported runtime, so you don't
  compile against APIs the floor lacks.
- **`typescript` stays on `^6`.** TypeDoc 0.28 crashes on load against TypeScript 7, and its peer
  range stops at `6.0.x`. The library itself compiles fine under 7 — only the API-reference build
  blocks.

## Publishing

Publishing goes through pnpm. Each package's `prepack` deliberately fails under bare `npm publish` or
`npm pack`, because npm ignores `publishConfig.exports` and would ship a tarball whose entry points
reference unbuilt TypeScript source.

Every package ships `files: ["dist", "README.md", "LICENSE"]` — tests, examples, and this site are
never in a tarball.
