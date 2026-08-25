---
title: Testing a backend
description: The shared contract suites exported from @node-media-library/core/testing, and how to hold your own backend to them.
---

If you implement one of this library's pluggable seams — a `MediaRepository`, a `QueueDriver`, or a
storage disk — you do not write your own test suite for it. You run the same suite every bundled
adapter runs.

```ts
import { runMediaRepositoryContract } from '@node-media-library/core/testing'
```

The `./testing` subpath is a published entry point of `@node-media-library/core`. It ships in the
tarball, so it is available to consumers, not just inside this repo.

The suites are written with [Vitest](https://vitest.dev) globals (`describe`, `it`, `expect`,
`beforeEach`). Call them at the top level of a test file, or inside a `describe` if you want to gate
them — they register cases rather than returning a result.

## Why the contract instead of your own tests

The contract is the specification. A backend that passes it behaves the way core expects; one that
doesn't will misbehave in ways your own tests are unlikely to look for, because the interesting cases
are not the obvious ones. The repository contract, for example, asserts that two concurrent
`setCustomProperty` calls for _different_ keys both survive — a read-modify-write implementation
passes every naive test and fails that one.

It is also how new requirements reach you. When a method is added to `MediaRepository`, its cases are
added to this contract, so the next release tells you whether your backend still conforms. That is why
this project's convention is to extend the contract rather than write parallel per-backend tests.

## `runMediaRepositoryContract`

```ts
runMediaRepositoryContract(name: string, factory: () => Promise<MediaRepository>): void
```

`factory` is called before every case and must return a **clean, empty** repository — the suite
assumes it starts from nothing. Doing the reset inside the factory is the simplest way to guarantee
that.

```ts
import { runMediaRepositoryContract } from '@node-media-library/core/testing'
import { prismaAdapter } from '@node-media-library/prisma'
import { getTestClient } from './helpers/client.js'

runMediaRepositoryContract('PrismaMediaRepository (sqlite)', async () => {
  const client = await getTestClient()
  await client.media.deleteMany({})
  return prismaAdapter(client)
})
```

What it covers:

- **Timestamps** — `create` stamps `createdAt`/`updatedAt`; `update` bumps `updatedAt`.
- **Lookup and scoping** — `findById`/`findByUuid` round-trips, and `findForModel` sorted by
  `orderColumn` ascending with nulls last then `createdAt`, filtered by collection, and scoped to the
  exact `(modelType, modelId)` pair rather than `modelId` alone.
- **JSON fidelity** — nested `customProperties`/`manipulations` objects survive a round-trip without
  mutation.
- **Filtering** — `iterateAll` honors `modelType`/`collectionName`, plus `customProperties` with AND
  across keys and deep structural equality on values.
- **Merge semantics** — `markConversionGenerated`, `mergeResponsiveImages`, `setCustomProperty`, and
  `removeCustomProperty` each modify one key without clobbering siblings, including **concurrently**
  for different keys.
- **Error and no-op behavior** — `delete` is idempotent, `removeCustomProperty` of a missing key is a
  no-op, and unknown ids reject with `MediaLibraryError` carrying `NOT_FOUND`.

The concurrency cases are the ones worth reading before you implement. The JSDoc on
`markConversionGenerated` in the `MediaRepository` interface states what guarantee a backend is
expected to provide, and what it may honestly narrow when its storage engine cannot serialize a
read-merge-write.

## `runInProcessQueueDriverContract`

```ts
runInProcessQueueDriverContract(
  name: string,
  factory: () => Promise<InProcessQueueDriver>,
  opts?: { waitForAsync?: () => Promise<void>; assertOrder?: boolean },
): void
```

For a driver that consumes in the same process it produces — one that implements `attach()`.

- `waitForAsync` — awaited wherever the suite needs deferred work to settle. Supply it for a driver
  that processes on a later tick; the default resolves immediately.
- `assertOrder` — set `false` for a driver that makes no ordering promise.

It covers: enqueuing with no attached processor rejects; the processor receives the exact job payload;
every enqueued job is processed; a later `attach` replaces an earlier one; `close()` resolves only
after already-enqueued work has settled and is idempotent; and `enqueue` rejects after `close()`.

## `runBrokerQueueDriverContract`

```ts
runBrokerQueueDriverContract(
  name: string,
  factory: () => Promise<BrokerQueueDriver>,
  opts?: { waitForAsync?: () => Promise<void> },
): void
```

For a driver backed by an external broker — one that implements `work()`.

It covers producing with no worker running and delivering that job once a worker appears; exact
payload delivery; `worker.close()` stopping delivery and waiting for an in-flight job, versus
`close({ force: true })` abandoning it; `driver.close()` closing the workers it created without
hanging, being idempotent, and a concurrent second `close()` not resolving before the first has
drained; and `enqueue` rejecting after `close()`.

:::caution
This suite drives the driver through `work()`. A bridge that delegates to your application's existing
queue — and therefore implements `work()` as a deliberate throw — **cannot pass it**, and is not
expected to. See
[Writing a queue driver](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/docs/writing-a-queue-driver.md)
for what to assert instead.
:::

## `runStorageCycleContract`

```ts
runStorageCycleContract(name: string, opts: { disk: DiskConfig; publicBaseUrl?: string }): void
```

Exercises a real disk end to end rather than a mock: it writes an original and reads it back
byte-identically, generates a conversion and a set of responsive variants **at their real keys** and
confirms each, produces a signed URL that actually fetches the object, runs `clean()` to list derived
files and remove an orphan, and finally deletes every object it wrote.

Pass `publicBaseUrl` to opt into the public-URL assertion as well; omit it for a backend with no
public domain attached. The private path via signed URLs is exercised either way.

Each run uses a unique key prefix, so concurrent CI jobs can share one bucket without colliding and
cleanup stays scoped to what that run created.

```ts
import { describe } from 'vitest'
import { runStorageCycleContract } from '@node-media-library/core/testing'

const endpoint = process.env.S3_ENDPOINT

describe.skipIf(!endpoint)('minio (requires S3_ENDPOINT)', () => {
  runStorageCycleContract('minio', {
    disk: {
      driver: 's3',
      bucket: process.env.S3_BUCKET ?? 'media-test',
      region: 'us-east-1',
      endpoint: endpoint!,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
      },
    },
  })
})
```

:::note
**This contract requires `sharp`**, which is an optional peer dependency of core. It generates its own
fixture image and drives `.format('png').withResponsiveImages()` conversions through the real
`sharpImageGenerator()`, so `sharp` must be installed to run it — a disk implementation with no image
library of its own still needs it here, because it is the contract's _fixture generator_ that needs
it, not the disk under test.

The import is dynamic, so a missing install surfaces an actionable "sharp is not installed" error at
first fixture generation rather than a raw module-resolution failure at import time. That changes
_when_ you find out, not whether `sharp` is needed.
:::

## Gating a suite on an unavailable service

These contracts talk to real services, so a suite that needs one it cannot reach should skip rather
than fail. Both examples above show the pattern: `describe.skipIf(...)` around the call, keyed on the
environment variable that supplies the connection. The bundled adapters do exactly this — the BullMQ
suite gates on `REDIS_URL`, RabbitMQ on `AMQP_URL`, and the S3 cycle on `S3_ENDPOINT` — so local runs
skip and CI, which provides them, runs the suites for real.
