# @node-media-library/core

Node.js port of [spatie/laravel-medialibrary](https://github.com/spatie/laravel-medialibrary) — manage media files (images, documents, etc.) for your application models.

> **Pre-release**: Not yet published to npm. The v1 surface covers file upload, storage, retrieval,
> collection organization, image conversions, responsive images, queue-backed dispatch, downloads/ZIP, a CLI, and
> offline maintenance (`clean()`), plus Spatie-parity extras: `copyMedia`/`moveMedia`, atomic custom-property
> updates, an image optimizer seam, and a GCS disk driver. PDF/video conversion generators live in
> `@node-media-library/pdf` and `@node-media-library/video`. A little design-spec surface still hasn't shipped —
> see [Roadmap](#roadmap) below.

## Installation

Once published:

```bash
pnpm add @node-media-library/core
```

## Quick Start

```typescript
import {
  createMediaLibrary,
  InMemoryMediaRepository,
  collection,
  conversion,
} from '@node-media-library/core'
import { join } from 'node:path'

const library = createMediaLibrary({
  repository: new InMemoryMediaRepository(),
  storage: {
    disks: {
      default: {
        driver: 'fs',
        root: join(process.cwd(), 'media'),
        // Required: the fs driver cannot derive a public URL on its own, so
        // url()/firstUrl() throw StorageError without it. Point it at the path
        // your server serves `root` from.
        baseUrl: 'http://localhost:3000/media',
      },
    },
  },
  // Default `queue` is `syncDriver()` (inline). `deferDriver()` (also built in) runs
  // them on a later tick without a broker; `bullmqDriver()` / `rabbitmqDriver()`
  // dispatch to a separate worker process. See "Queue drivers" below.
  models: {
    User: {
      collections: {
        avatar: collection()
          .singleFile()
          .acceptsMimeTypes(['image/*'])
          .conversions({ thumb: conversion().width(64).height(64).nonQueued() }),
        gallery: collection().onlyKeepLatest(10),
      },
    },
  },
})

// Add a file
const file = await import('node:fs/promises').then((fs) => fs.readFile('photo.png'))
const media = await library.for('User', userId).add(file).usingName('Avatar').toCollection('avatar')

// Retrieve files
const all = await library.for('User', userId).getAll()
const url = await library.for('User', userId).firstUrl('avatar')
const thumbUrl = await library.for('User', userId).firstUrl('avatar', 'thumb')

// Manage collections
await library.for('User', userId).reorder([mediaId2, mediaId1])
await library.for('User', userId).clear('gallery')
```

## Configuration reference

Only `repository` and `models` are required. Everything else below has a default that works, so a
minimal config is genuinely two keys.

| Key                         | Type                  | Default                            | Notes                                                                                          |
| --------------------------- | --------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `repository`                | `MediaRepository`     | **required**                       | `InMemoryMediaRepository` for tests; `@node-media-library/prisma` for real use.                |
| `models`                    | `Record<string, {…}>` | **required**                       | `for()` throws `UnknownModelError` for a type absent from this map.                            |
| `storage`                   | `StorageConfig`       | synthesized from env               | See [Storage disks](#storage-disks).                                                           |
| `queue`                     | `AnyQueueDriver`      | `syncDriver()`                     | See [Queue drivers](#queue-drivers).                                                           |
| `maxFileSize`               | `number`              | `10 * 1024 * 1024`                 | Enforced during accumulation, not after the bytes land.                                        |
| `disallowedExtensions`      | `string[]`            | `DEFAULT_DISALLOWED_EXTENSIONS`    | Checked per dot-segment.                                                                       |
| `allowedExtensions`         | `string[]`            | none                               | When set, acts as an allowlist instead.                                                        |
| `versionUrls`               | `boolean`             | `false`                            | Cache-busting version query on generated URLs.                                                 |
| `signedUrlExpiresIn`        | `string \| number`    | `'30 mins'`                        | Default `signedUrl()` expiry; the `fs` driver ignores it (it cannot sign).                     |
| `fileNameSanitizer`         | `FileNameSanitizer`   | built-in                           | A security control — see [Security model](#security-model) before replacing it.                |
| `pathGenerator`             | `PathGenerator`       | `DefaultPathGenerator`             | `{prefix}/{mediaId}/{fileName}`.                                                               |
| `urlGenerator`              | `UrlGenerator`        | `DefaultUrlGenerator`              | Only needed to replace URL generation entirely — a custom CDN hostname is `baseUrl`, not this. |
| `imageGenerators`           | `ImageGenerator[]`    | `[sharpImageGenerator()]`          | Nothing auto-registers — add pdf/video generators explicitly.                                  |
| `optimizers`                | `ImageOptimizer[]`    | `[]`                               | See [Image optimizers](#image-optimizers).                                                     |
| `responsiveWidthCalculator` | `WidthCalculator`     | `FileSizeOptimizedWidthCalculator` | See [Responsive images](#responsive-images).                                                   |
| `responsivePlaceholders`    | `boolean`             | `true`                             | LQIP generation alongside responsive variants.                                                 |

## Custom properties, copy, and move

`setCustomProperty`/`removeCustomProperty` update a single key atomically — sibling keys already present in
`customProperties` are preserved, and the update is a dedicated repository primitive (not a read-modify-write of
the whole `customProperties` blob at the library layer):

```typescript
await library.setCustomProperty(media.id, 'alt', 'A sunset over the bay')
await library.removeCustomProperty(media.id, 'alt')
```

`copyMedia`/`moveMedia` re-run the full add pipeline against a target model/collection — the target collection's
validation, rules, and disks govern the result, and every derived file (conversions, responsive variants) is
**regenerated**, never byte-copied from the source's derived files. `moveMedia` is copy-then-delete-source: if
the copy step fails, the source media is left untouched.

```typescript
const copy = await library.copyMedia(media.id, 'User', otherUserId, { toCollection: 'avatar' })
const moved = await library.moveMedia(media.id, 'User', otherUserId)
```

Both emit typed events: `media:copied` (`{ media, copy }`) and `media:moved` (`{ media, moved }`).

## Image optimizers

Optionally register binary optimizers to run before every conversion/responsive file write. A result is only
accepted if it's strictly smaller than the input; an optimizer that throws is warned and skipped (never fails the
conversion); originals and LQIP placeholders are never optimized.

```typescript
import { createMediaLibrary } from '@node-media-library/core'
import { jpegoptimOptimizer, pngquantOptimizer } from '@node-media-library/optimizers'

createMediaLibrary({
  // ...
  optimizers: [jpegoptimOptimizer(), pngquantOptimizer()],
})
```

`jpegoptimOptimizer()`/`pngquantOptimizer()` shell out to the `jpegoptim`/`pngquant` SYSTEM binaries (install via
`apt install jpegoptim pngquant` or `brew install jpegoptim pngquant` — they are not bundled). A missing binary
makes the optimizer a no-op. You can also write your own by implementing the `ImageOptimizer` interface
(`{ name, optimize(buffer, ctx: OptimizeContext): Promise<Buffer | null> }`).

The shipped optimizers key off `ctx.format`, which is only set for conversions with an explicit
`.format('jpeg')`/`.format('png')` (or a PDF/video rasterization, which resolves to `png`) — a conversion left at
the keep-original-format default, and responsive variants generated from the original file, carry no `ctx.format`
and pass through both optimizers unoptimized.

## Responsive images

Opt in per collection, per conversion, or per upload:

```typescript
collection().withResponsiveImages() // every original gets variants
conversion().width(400).format('webp').withResponsiveImages() // + variants for this conversion
library.for('User', userId).add(file).withResponsiveImages() // one-off, even without collection opt-in
```

When enabled, a set of progressively narrower variants is generated for the original file (stored under the
pseudo-conversion name `'original'`) and/or any conversion that opts in, alongside an optional low-quality
placeholder (LQIP).

Read the results with:

```typescript
const srcset = await library.srcset(media.id) // 'url1 1600w, url2 1120w, ...' — original variants
const previewSrcset = await library.srcset(media.id, 'preview') // variants for the 'preview' conversion
const urls = await library.responsiveUrls(media.id) // widest-first URL array
const placeholder = await library.placeholder(media.id) // 'data:image/svg+xml;base64,...' or null
```

All three return `null`/`[]` when there's no responsive entry for that conversion (or for a custom
`UrlGenerator` that doesn't implement `responsiveUrl`).

Config knobs on `createMediaLibrary()`:

```typescript
createMediaLibrary({
  // ...
  responsiveWidthCalculator: new FileSizeOptimizedWidthCalculator(), // default; swap in your own WidthCalculator
  responsivePlaceholders: true, // set false to skip LQIP generation
})
```

Variant files are stored on the media's own disk at:

```
{mediaId}/responsive/{base}___{conversion}_{width}_{height}.{ext}
```

e.g. `{mediaId}/responsive/photo___original_1600_1200.jpg` and `{mediaId}/responsive/photo___preview_400_300.webp`.

To backfill or repair responsive variants for existing media, pass `withResponsive: true` to `regenerate()`:

```typescript
await library.regenerate({ withResponsive: true }) // (re)generate for every eligible record
await library.regenerate({ withResponsive: true, onlyMissing: true }) // only records missing an 'original' entry
```

## Other file types (PDF, video)

Core only ships `sharpImageGenerator()` (used by default when `imageGenerators` is omitted). Support for
non-image sources is added by explicitly appending a generator from the corresponding package — there's no
auto-detection or implicit registration:

```typescript
import { createMediaLibrary, sharpImageGenerator } from '@node-media-library/core'
import { pdfImageGenerator } from '@node-media-library/pdf'
import { videoImageGenerator } from '@node-media-library/video'

createMediaLibrary({
  // ...
  imageGenerators: [sharpImageGenerator(), pdfImageGenerator(), videoImageGenerator()],
})
```

- `@node-media-library/pdf` renders PDF pages via poppler's `pdftoppm` binary — select the page with
  `conversion().pdfPageNumber(n)` (default page 1). Requires `pdftoppm` on the system (`brew install poppler` /
  `apt install poppler-utils`).
- `@node-media-library/video` extracts a still frame via the `ffmpeg` binary — select the timestamp with
  `conversion().videoFrameAtSecond(n)` (default 0). Requires `ffmpeg` on the system.

Both generators also implement `toSourceImage`, so `.withResponsiveImages()` (collection, conversion, or
per-upload) works the same way it does for images: it rasterizes the source once and derives the responsive
variant set from that raster, not from the original PDF/video bytes.

If a media file's MIME type isn't `supports()`-ed by any configured generator, conversions and responsive
images for that file are skipped silently — the upload itself still succeeds and the file remains usable as a
plain (attachment-only) piece of media.

## Queue drivers

Every `MediaLibrary` is configured with exactly one queue driver, and every driver is one of two kinds:

- **In-process** (`syncDriver()`, `deferDriver()`) — conversions run inline, in the same process that
  called `add()`. `MediaLibrary`'s constructor attaches its processor to these automatically; there is
  no separate worker.
- **Broker-backed** (`bullmqDriver()` from `@node-media-library/bullmq`, `rabbitmqDriver()` from
  `@node-media-library/rabbitmq`) — jobs are handed to an external broker. **Constructing a
  `MediaLibrary` with a broker driver does not start consuming.** A web process, a serverless handler,
  or a script that just needs to read/write media can hold a `MediaLibrary` configured with
  `bullmqDriver`/`rabbitmqDriver` and never touch the broker as a consumer.

Consuming from a broker requires an explicit worker, started with `MediaLibrary.startWorker()`:

```typescript
// worker.ts — a dedicated process, never the web process
const worker = await library.startWorker({ concurrency: 4 })
process.on('SIGTERM', () => worker.close()) // waits for in-flight jobs; { force: true } to abandon them
```

`startWorker()` throws a `MediaLibraryError` if the configured driver is in-process — those run
conversions inline and have no separate worker to start. Separately, the `MediaLibrary` constructor
itself throws if the configured driver implements _both_ `attach()` and `work()`, before `startWorker()`
is ever reached: that shape would consume inline in every process that constructs a `MediaLibrary`
while `startWorker()` consumes from the broker too, which is exactly the accident the two interfaces
exist to prevent. Both checks probe for a _callable_ member (`typeof driver.attach === 'function'`),
not merely a present one, so a driver object that merely declares the property (e.g. `attach:
undefined` from an unused optional field) is correctly treated as not implementing it.

Every job a broker driver delivers is shape-checked before it reaches the conversion engine: a payload
without a string `mediaId`, or with a `conversionNames` that is neither absent nor an array of strings,
is rejected with a `MediaLibraryError` right at the `startWorker()` choke point. Third-party drivers
inherit this for free, and the rejection travels whatever nack/dead-letter path the driver already
uses for a failed job — a driver author does not need to validate the payload itself.

Call `library.close()` when you're done with a `MediaLibrary` (worker or producer) to release the
driver's underlying connections/channels. **`close()` drains in-flight jobs with no timeout** — a
wedged processor hangs shutdown forever. If your process has its own `SIGTERM` handling, race it
against your own timer rather than awaiting it unbounded.

The package also ships a `worker` CLI command, a convenience wrapper around the same call that traps
`SIGTERM`/`SIGINT`, drains in-flight jobs, and escalates to a forced close after `--shutdown-timeout`
elapses (the escalation cuts a wedged drain short with `rabbitmqDriver`; with `bullmqDriver` it does
not — BullMQ's own `Worker.close()` memoizes its close promise on the first call, so the forced call
just returns the still-pending graceful close instead of skipping the drain, and shutdown keeps
blocking on the in-flight jobs past `--shutdown-timeout`):

```bash
node-media-library worker --config ./medialibrary.config.ts [--concurrency 4] [--shutdown-timeout 30]
```

`--config` can be omitted if a `medialibrary.config.ts` / `.mts` / `.js` / `.mjs` file (default-exporting
a `MediaLibrary` instance) exists in the current directory — the same convention `regenerate` and
`clean` follow (see [CLI](#cli) below). `--concurrency` must be a positive integer (it's forwarded
verbatim to BullMQ's `concurrency` and amqplib's `prefetch`, neither of which accepts a fraction) and
`--shutdown-timeout` a positive number; both are validated before the config is even loaded, so a typo'd
flag never opens a broker connection just to immediately tear it down. `library.close()` is called on
every exit path of every command — `regenerate`, `clean`, and `worker` (including a failed
`startWorker()`) — so a broker driver's open connection can no longer keep the process alive after the
command has finished.

### Choosing a driver from an environment variable

Selecting a backend by environment variable is a pattern you write yourself, not a helper this package
ships (see the [design rationale](../../docs/superpowers/specs/2026-08-08-queue-driver-redesign-design.md)
for why). Fail closed on an unrecognized value — a typo'd environment variable should crash loudly, not
silently fall back to `syncDriver()` and run heavy image conversions inline inside HTTP requests:

```typescript
function resolveQueue() {
  switch (process.env.MEDIA_QUEUE ?? 'sync') {
    case 'sync':
      return syncDriver()
    case 'bullmq':
      return bullmqDriver({ connection: { url: process.env.REDIS_URL! } })
    case 'rabbitmq':
      return rabbitmqDriver({ url: process.env.AMQP_URL! })
    default:
      throw new Error(`unknown MEDIA_QUEUE: ${process.env.MEDIA_QUEUE}`)
  }
}
```

This only validates `MEDIA_QUEUE`. For fail-fast validation of your app's _other_ environment variables
too, reach for a dedicated library (`envalid`, `zod`, `t3-env`) rather than hand-rolling checks per
variable.

### Writing your own driver

See [`packages/core/docs/writing-a-queue-driver.md`](docs/writing-a-queue-driver.md) for the full
`InProcessQueueDriver`/`BrokerQueueDriver` contract, `close()` semantics, the at-least-once delivery
guarantee (processors must be idempotent), and how to validate a new driver against the exported
contract-test suites.

## Storage disks

`storage.disks` accepts `fs`, `s3`, `r2`, and `gcs` driver configs. Without explicit config, the default disk
is synthesized from env vars at startup, in this precedence: `MEDIA_R2_ACCOUNT_ID` set → R2; else
`MEDIA_S3_BUCKET` set → S3; else `MEDIA_GCS_BUCKET` set → GCS; else local fs (`MEDIA_FS_ROOT`, default
`./storage/media`). `MEDIA_R2_ACCOUNT_ID` without `MEDIA_R2_BUCKET` throws rather than silently falling
through to another driver.

```typescript
createMediaLibrary({
  storage: {
    disks: {
      default: {
        driver: 'gcs',
        bucket: 'my-bucket',
        visibility: 'private', // default
        projectId: 'my-gcp-project', // optional; falls back to ADC/env
        keyFilename: '/path/to/service-account.json', // optional
      },
    },
  },
})
```

Requires the optional peer `@google-cloud/storage ^7.10.2` — install it alongside `@node-media-library/core` to
use the `gcs` driver.

Cloudflare R2:

```ts
storage: {
  default: 'r2',
  disks: {
    r2: {
      driver: 'r2',
      accountId: process.env.R2_ACCOUNT_ID!,
      bucket: 'my-media',
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      // Required only for `.public()` collections: R2 has no object ACLs, so
      // public access comes from an r2.dev subdomain or a custom domain.
      baseUrl: 'https://cdn.example.com',
    },
  },
}
```

`r2` derives the S3 API endpoint from `accountId` (override with `endpoint` for R2's EU jurisdiction),
forces `supportsACL: false` (R2 rejects the ACL header flydrive would otherwise send), and sets
`region: 'auto'`. It's normalized into the `s3` shape internally, so it shares that driver's code path.

The `s3` and `r2` drivers need the AWS SDK, which is an optional peer:

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Synthesized-from-env config also supports R2 via `MEDIA_R2_ACCOUNT_ID`, `MEDIA_R2_BUCKET`,
`MEDIA_R2_BASE_URL`, `MEDIA_R2_ACCESS_KEY_ID`, and `MEDIA_R2_SECRET_ACCESS_KEY`, at the precedence noted
above (R2 → S3 → GCS → fs).

### URL building per driver

- **`fs` requires `baseUrl`.** The `DefaultUrlGenerator` short-circuits to `{baseUrl}/{path}` for `fs` disks;
  without it, it falls through to flydrive's `disk.getUrl()`, which the FS driver refuses to implement — so
  `url()`/`firstUrl()` throw `StorageError`. Serve the disk's `root` statically and point `baseUrl` at it.
- **`signedUrl()` does not sign on the `fs` driver.** It returns the plain public URL and ignores `expiresIn`
  (documented dev-mode behavior — the returned URL never expires). Use `s3`/`gcs` for genuinely time-limited
  URLs, or serve the bytes yourself via `download()`/`inline()` behind your own authorization.
- **`baseUrl` sets the public URL base on every driver**, not just `fs` — point it at a CDN hostname in
  front of an `s3`/`r2`/`gcs` bucket and `url()`/`firstUrl()` use it. Signed URLs are the one exception:
  they always presign against the real endpoint and ignore `baseUrl`, because a presigned URL is only
  valid against the host it was signed for.

## Security model

- **MIME type is sniffed, never trusted.** The pipeline detects MIME from the actual file bytes (`file-type`'s
  magic-byte sniffing) for every source kind — buffer, stream, path, base64, or URL download. A client-supplied
  `Content-Type` header or filename extension is never used as the MIME type; `acceptsMimeTypes` and generator
  dispatch (`ImageGenerator.supports()`) both check the sniffed value.
- **Extension blocklist + filename sanitizer.** The default disallowed-extension list (`php`, `phtml`, `phar`,
  `htaccess`) is checked against **every dot-separated segment** of the filename, not just the final extension —
  `evil.php.jpg` is rejected. The default `fileNameSanitizer` also strips path separators (`/`, `\`), control
  characters, and leading dots, and resolves via `basename()` before that check runs, so a filename can't smuggle
  a nested storage key or `..` traversal past it. **This applies to every filename source** — a source-derived
  name and an explicit `usingFileName(...)` are both sanitized the same way.
  **Loud warning**: if you replace `limits.fileNameSanitizer` with your own function, you also replace the
  traversal/blocklist protection it provides — a permissive custom sanitizer that doesn't strip `/`, `\`, and
  `..` reopens exactly the holes described above. Extend the default sanitizer rather than starting from scratch
  unless you're certain of what you're removing.
- **`maxFileSize` is enforced during accumulation, not just after.** For stream and URL sources, bytes are capped
  as they arrive (`FileTooLargeError` thrown as soon as the running total exceeds the limit) rather than being
  buffered in full first — a hostile stream or URL response can't force unbounded memory use before the size
  check runs.
- **URL ingestion (`{ url, allowedHosts }` sources)**: an `allowedHosts` allowlist can restrict downloads to
  specific hosts (exact host:port match, case-insensitive), and redirects are followed with `redirect: 'error'`
  so a redirect to a non-allowlisted host can't defeat the allowlist. Caveat: the allowlist checks the hostname
  as given — it does not defend against DNS-rebinding, or against a hostname you've explicitly allowlisted that
  happens to resolve to a private/internal IP. If you ingest URLs from untrusted input, put a network-level
  proxy or egress policy in front of this rather than relying on `allowedHosts` alone.
- **Private-by-default storage.** Disks default to `visibility: 'private'` (see `synthesizeDefaultDisk` in
  `storage/resolve.ts`); `url()` vs. `signedUrl()` is the caller's per-call choice regardless of a collection's
  visibility setting. `collection().public()` marks that collection's writes (original, conversions, and
  responsive variants) with `{ visibility: 'public' }` — it does not change which URL-generation method you
  call.
- **What `.public()` actually does depends on the driver.** On `s3` and `gcs`, that write option makes the
  driver apply public ACLs/permissions to the object, so per-object visibility is real. **On `r2`, it's a
  storage-layer no-op** — Cloudflare R2 has no object ACLs, so visibility there is a property of the _bucket_
  (whether an r2.dev subdomain or a custom domain is attached to it), not the object. A `.public()` collection
  on an `r2` disk with no `baseUrl` throws when the `MediaLibrary` is constructed, because such a URL could
  never resolve.
- **Mixing public and private collections on one R2 bucket is unsupported.** If the bucket has a public
  domain attached, every object in it — including the ones from your "private" collections — is reachable by
  anyone who can guess or obtain the key. What actually protects a private object is key unguessability, not
  ACLs: default keys are `{prefix}/{mediaId}/{fileName}`, where `mediaId` is a random UUID. Use two disks
  instead — a public-domain bucket for `.public()` collections and a bare bucket for the rest — via
  `collection().useDisk()` / `.storeConversionsOnDisk()`. Configuring one R2 disk with `baseUrl` for both
  kinds of collection triggers a `console.warn` at construction.

## CLI

The package ships a `node-media-library` bin with `regenerate`, `clean`, and `worker` commands (the
latter documented above, under "Queue drivers"). It expects a config module that default-exports a
`MediaLibrary` instance:

```bash
node-media-library regenerate --config media.config.mjs --model User --only-missing --with-responsive
node-media-library clean --config media.config.mjs --dry-run --delete-orphaned --rate-limit 10
```

Running the CLI from a checkout of this repo (rather than an installed package) requires `pnpm build` first —
the bin points at `./dist/cli.js`, which is only produced by the build step, not present in `src/`. `.ts` configs
need to be executed with a TypeScript loader such as `tsx`.

## Roadmap

**Current**: File upload, storage (fs/s3/r2/gcs), retrieval, collections, image conversions, responsive images, queue-backed dispatch (sync, BullMQ, and RabbitMQ), Prisma adapter, PDF/video image generators, downloads/ZIP, CLI, offline maintenance (`clean()`), `copyMedia`/`moveMedia`, atomic custom-property updates, and an image optimizer seam (`@node-media-library/optimizers`).

**Known limitations** (architectural, not scheduled for v1):

- `@node-media-library/video` reads the whole source video into memory (`Buffer`) before shelling out to `ffmpeg`, and spawns a separate `ffmpeg` process per frame extraction — an N+1 spawn pattern when a media item has multiple video-derived conversions. Fine for typical use; not tuned for very large video files or high-conversion-count workloads.
- The Prisma adapter's JSON-column merges (`setCustomProperty`, `markConversionGenerated`, `mergeResponsiveImages`, etc.) run inside `$transaction` when the client provides one, but that alone doesn't take a row lock on Postgres/MySQL's default read-committed isolation — two concurrent merges on the _same_ record can still lose a write. SQLite's single-writer model doesn't have this gap. See the honesty note on `mergeJsonColumn` in `packages/prisma/src/adapter.ts`.
- MinIO covers the `s3` path in CI (via `S3_ENDPOINT`-gated tests), but it accepts ACLs, so it can't exercise R2's `supportsACL: false` path or its checksum handling. R2-specific behavior is only verified when `R2_*` repository secrets are configured and the gated R2 suite runs for real.

**Remaining**: Publish to npm.

## License

MIT
