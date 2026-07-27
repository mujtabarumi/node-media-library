# @node-media-library/bullmq

BullMQ queue driver for `@node-media-library/core`. Pre-release: not yet published to npm.

## Install
Once published: `npm install @node-media-library/bullmq bullmq`
`bullmq` (`^5`) is a required peer dependency.

## Usage
Wire it into `createMediaLibrary` via the `queue` option:
```ts
import { createMediaLibrary } from '@node-media-library/core'
import { bullmqDriver } from '@node-media-library/bullmq'

const media = createMediaLibrary({
  repository,
  storage: { disks: { default: { driver: 'fs', root: './storage' } } },
  models: { User: {} },
  queue: bullmqDriver({ connection: { url: process.env.REDIS_URL! } }),
})
```
`Queue`/`Worker` instances are created lazily on first `enqueue`/`registerProcessor` call, so constructing the driver never touches Redis.

## Worker process
Conversion processing registration happens inside the `MediaLibrary` constructor, so run a separate process with the *same* config and keep it alive:
```ts
// worker.ts
import { createMediaLibrary } from '@node-media-library/core'
import { bullmqDriver } from '@node-media-library/bullmq'

createMediaLibrary({
  repository,
  storage: { disks: { default: { driver: 'fs', root: './storage' } } },
  models: { User: {} },
  queue: bullmqDriver({ connection: { url: process.env.REDIS_URL! }, workerConcurrency: 4 }),
})
// keep the process alive; the Worker created above processes jobs.
```

## Options
`bullmqDriver({ connection, queueName, workerConcurrency })`: `connection` is passed straight through to BullMQ's `Queue`/`Worker` (ioredis options, an `{ url }` object, or an ioredis instance). `queueName` defaults to `'media-conversions'`, `workerConcurrency` defaults to `2`.

## Tests
The contract suite (`test/driver.test.ts`) is Redis-gated: set `REDIS_URL` to run it against a real broker, e.g. `REDIS_URL=redis://localhost:6379 npx vitest run`. Without `REDIS_URL` it skips with a printed warning, and a separate unconditional test confirms construction never touches Redis.
