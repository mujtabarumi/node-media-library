# @node-media-library/core

## 1.0.0

> **First published release.** The entries below record development that predates this package
> reaching npm, so the breaking-change and migration notes describe commits rather than a shipped
> release. Nothing here requires action from a new installation.

### Major Changes

- d092bf5: Split `QueueDriver` into `InProcessQueueDriver` (`attach`) and `BrokerQueueDriver` (`work`), and stop
  attaching a processor to broker drivers at construction — a process that merely constructs a
  `MediaLibrary` no longer consumes conversion jobs. Consuming now requires an explicit
  `MediaLibrary.startWorker()`, or the new `node-media-library worker` command.

  `registerProcessor` is removed. In-process drivers use `attach`; broker drivers use `work`, which
  returns a `QueueWorker` whose `close()` waits for in-flight jobs unless forced. `deferDriver.close()`
  now drains its scheduled callbacks instead of resolving while work is still pending.

  A driver implementing _both_ `attach()` and `work()` is now rejected: the `MediaLibrary` constructor
  throws a `MediaLibraryError` before wiring anything. The union type admits that shape, but it would
  consume inline in every process that constructs a `MediaLibrary` while `startWorker()` also consumed
  from the broker — reinstating the exact defect this split removes.

  Adds `@node-media-library/rabbitmq`, an amqplib-backed driver accepting either a `url` or a
  caller-owned `connection`. Note that `amqp-connection-manager` is **not** a compatible `connection`
  (its `createChannel()` is synchronous and returns a `ChannelWrapper`, and it has no
  `createConfirmChannel()` at all), so reconnection is the caller's responsibility — see that package's
  "Known limitations".

  `rabbitmqDriver.enqueue()` now publishes on a confirm channel and resolves only once the broker has
  acknowledged the message (rejecting with a `MediaLibraryError` on a nack), rather than resolving as
  soon as the bytes reached a socket buffer. This is a **breaking change to the exported
  `AmqpLikeConnection` interface**: a caller-supplied `connection` must now provide a
  `createConfirmChannel()` alongside `createChannel()`, both resolving to real amqplib
  `Channel`/`ConfirmChannel` objects — the `url` option is unaffected, since amqplib's own connection
  already has both.

  Both broker drivers gain an `onError?: (err: Error) => void` option, called on every `'error'` event
  from the underlying connection/channels (`rabbitmqDriver`) or `Queue`/`Worker` (`bullmqDriver`) —
  without a listener, Node treats an unhandled `'error'` event as an uncaught exception rather than a
  rejected call. Defaults to logging via `console.error`. `rabbitmqDriver` also rejects an oversized
  consumed message (over 64 KiB) before parsing it, reporting the rejection through `onError`.

  `MediaLibrary.startWorker()` now shape-checks every job payload before it reaches the conversion
  engine, throwing `MediaLibraryError` for a payload without a string `mediaId` or with a
  `conversionNames` that isn't absent or an array of strings — third-party drivers inherit this for free
  and don't need to validate payloads themselves. The in-process/broker driver discriminator now probes
  for a callable `attach`/`work` member instead of using the `in` operator, so a declared-but-`undefined`
  property (an unused optional field, an object spread) is no longer mistaken for an implemented one.

  The `node-media-library worker`/`regenerate`/`clean` CLI commands now close the `MediaLibrary` on
  every exit path, including a failed `worker` start — previously only some paths did, so a broker
  driver's open connection could keep the process running indefinitely after the command had already
  finished. `--concurrency` must now be a positive integer (previously any positive number), and both it
  and `--shutdown-timeout` are validated before the config loads.

### Minor Changes

- ea06f00: Add first-class Cloudflare R2 support via a new `driver: 'r2'` disk config, which derives the S3 API endpoint from your account ID, disables the ACL headers R2 rejects, and builds public URLs from `baseUrl`.

  The `s3` driver gains `credentials`, `supportsACL`, `forcePathStyle`, and `requestChecksumCalculation`, making MinIO, Backblaze B2, and DigitalOcean Spaces configurable too. `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are now declared as optional peer dependencies — install them to use `s3` or `r2`.

  `baseUrl` is now honored on every driver, not just `fs`. **If you already set `baseUrl` on an `s3` or `gcs` disk it was silently ignored, and public URLs will now be built from it.** That was the documented behavior it replaces, but it does change the URLs those disks emit.

  Public collections on an R2 disk with no `baseUrl` now throw when the `MediaLibrary` is constructed, because R2 has no object ACLs and such a URL could never resolve. Supplying your own `urlGenerator` downgrades that to a `console.warn` — a custom generator may build public URLs from CDN logic core cannot see, so core must not declare the configuration broken.

  `url()` (and `firstUrl()`, `availableUrl()`, `responsiveUrl()`, `responsiveUrls()`, `srcset()`) now throw `StorageError` for **any** collection on an `r2` disk with no `baseUrl`, not just `.public()` ones. They previously returned `https://{accountId}.r2.cloudflarestorage.com/{bucket}/{key}` — the authenticated S3 API host, which rejects anonymous reads — so the change is from a silently dead link to a loud error. Set `baseUrl`, or use `signedUrl()`, which is unaffected.

- 6698e20: Raise the supported Node floor from `>=20` to `>=22`.

  `file-type@22`, a runtime dependency of core, declares `node: >=22`. Core previously declared
  `>=20`, so installing on Node 20 produced an `EBADENGINE` warning (and a hard failure under
  `engine-strict`) while the package claimed to support it. Every package's `engines` field now says
  `>=22`, matching what the dependency tree actually requires.

  **Node 20 is no longer supported.** Consumers on Node 20 should stay on the previous release or
  upgrade to Node 22. `@types/node` moves to `^22` to keep types tracking the minimum supported
  runtime, and CI now tests Node 22 only.

### Patch Changes

- e8b7700: Update `archiver` to 8.x. Version 8 is ESM-only and replaced the callable `archiver('zip')` factory
  with named class exports, so `zip()` now constructs `new ZipArchive()`. No change to `zip()`'s
  signature, return type, or lazy-streaming behavior. `archiver` 8 requires Node >=18, which is below
  this project's >=22 floor, so the supported runtime range is unchanged.
- 8f9bf4d: Fix README examples that don't match shipped behavior. The core Quick Start omitted `baseUrl` from its
  `fs` disk config, so its own `firstUrl()` calls threw `StorageError`; the PDF and video packages showed
  `conversion().…toDefinition()` as the usage form, but `conversions()` takes builders and calls
  `toDefinition()` itself. Core also gains a "URL building per driver" section documenting that
  `signedUrl()` does not sign on the `fs` driver and that `baseUrl` is unconsumed by `s3`/`gcs`.
- 6be9a32: Document configuration as a first-class topic rather than something readers assemble from examples.
  The package README gains a "Configuration reference" table covering all sixteen `MediaLibraryConfig`
  keys with their defaults — `versionUrls`, `signedUrlExpiresIn`, `allowedExtensions`,
  `responsiveWidthCalculator`, and `responsivePlaceholders` had no prose documentation anywhere — and
  the Quick Start's queue comment now names `deferDriver()` and `rabbitmqDriver()` alongside
  `bullmqDriver()`, which it had omitted since the driver split.

  No behavior change.
