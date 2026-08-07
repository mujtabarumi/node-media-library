# node-media-library

[![CI](https://github.com/mujtabarumi/node-media-library/actions/workflows/ci.yml/badge.svg)](https://github.com/mujtabarumi/node-media-library/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)

**Attach files to anything in your app — then stop thinking about them.**

You register a model type (`User`, `Post`, `Invoice`) and the collections that hang off it (`avatar`,
`gallery`, `attachments`). From then on, one call stores the file, validates it, derives the thumbnails
and responsive variants you declared, and gives you back a URL. Deleting the record deletes every
derived file with it.

```ts
const media = await library.for('User', user.id).add(uploadedFile).toCollection('avatar')

await library.for('User', user.id).firstUrl('avatar', 'thumb')
// → 'https://cdn.example.com/9f3.../conversions/photo-thumb.jpg'
```

It's a Node port of [spatie/laravel-medialibrary](https://github.com/spatie/laravel-medialibrary) —
the same mental model (models → collections → conversions), rebuilt on Node primitives: pluggable
storage via [flydrive](https://flydrive.dev) (fs/S3/GCS), a pluggable repository (Prisma adapter
included), a pluggable queue (BullMQ adapter included), and [sharp](https://sharp.pixelplumbing.com)
for image work. It is **not** a transliteration — see
[Coming from the Laravel package](#coming-from-spatielaravel-medialibrary).

> **Status: pre-release.** Not yet published to npm. The API below is what's implemented and tested
> in this repo today; install from a git checkout until the first release.

---

## Contents

- [What you get](#what-you-get)
- [Requirements](#requirements)
- [Install](#install)
- [Five-minute example](#five-minute-example)
- **Recipes**
  - [1. User avatars — one file, auto-thumbnail, fallback image](#1-user-avatars--one-file-auto-thumbnail-fallback-image)
  - [2. Product galleries — ordering, responsive `srcset`, keep-latest](#2-product-galleries--ordering-responsive-srcset-keep-latest)
  - [3. Private documents — signed URLs, streamed downloads, bulk ZIP](#3-private-documents--signed-urls-streamed-downloads-bulk-zip)
  - [4. Accepting uploads from Express, Hono, or Next.js](#4-accepting-uploads-from-express-hono-or-nextjs)
  - [5. Getting conversions off the request path](#5-getting-conversions-off-the-request-path)
  - [6. Thumbnails for PDFs and videos](#6-thumbnails-for-pdfs-and-videos)
  - [7. Importing a file from a URL, safely](#7-importing-a-file-from-a-url-safely)
  - [8. Metadata, search, copy and move](#8-metadata-search-copy-and-move)
- **Production**
  - [Persistence with Prisma](#persistence-with-prisma)
  - [Storage disks](#storage-disks)
  - [Security defaults](#security-defaults)
  - [Maintenance CLI](#maintenance-cli)
- [Packages](#packages)
- [Coming from spatie/laravel-medialibrary](#coming-from-spatielaravel-medialibrary)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)

---

## What you get

|                          |                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Any source**           | Filesystem path, `Buffer`, `Readable`, web `File`/`Blob`, base64, or a remote URL (with a host allowlist).                            |
| **Collections**          | Per-collection rules: `singleFile()`, `onlyKeepLatest(n)`, accepted MIME types, custom predicates, its own disk, a fallback URL.      |
| **Conversions**          | Declarative resize/crop/format/quality/blur/greyscale, run inline or on a queue, stored beside the original and cleaned up with it.   |
| **Responsive images**    | Generated variant sets plus an LQIP placeholder; read back as a ready-made `srcset` string.                                           |
| **Serving**              | Public URLs, signed URLs, web-standard `Response` for download/inline, and streamed multi-file ZIPs — no temp files.                  |
| **Pluggable everything** | Repository, queue, storage disk, path/URL generation, image generators, and image optimizers are all interfaces you can swap.         |
| **Safe by default**      | MIME sniffed from bytes, filenames sanitized, extension blocklist, size caps enforced while streaming, private-by-default visibility. |
| **Operations**           | `regenerate()` to backfill conversions, `clean()` to delete orphans and stale derivatives, both exposed as a CLI.                     |

## Requirements

- **Node ≥ 22**
- A repository backend — the bundled `InMemoryMediaRepository` for tests, `@node-media-library/prisma`
  for real use, or your own `MediaRepository`
- Optional system binaries, only for the packages that use them: `pdftoppm` (PDF), `ffmpeg` (video),
  `jpegoptim`/`pngquant` (optimizers). Each package no-ops or skips when its binary is absent.

## Install

```bash
pnpm add @node-media-library/core
```

Add adapters as you need them:

```bash
pnpm add @node-media-library/prisma      # database-backed repository
pnpm add @node-media-library/bullmq      # queued conversions
pnpm add @node-media-library/pdf         # PDF page thumbnails
pnpm add @node-media-library/video       # video frame thumbnails
pnpm add @node-media-library/optimizers  # jpegoptim / pngquant
```

## Five-minute example

Everything below is real, runnable code — an in-memory repository and a local disk, so there's nothing
to provision.

```ts
// media.ts
import {
  createMediaLibrary,
  InMemoryMediaRepository,
  collection,
  conversion,
} from '@node-media-library/core'

export const library = createMediaLibrary({
  repository: new InMemoryMediaRepository(),
  storage: {
    disks: {
      default: {
        driver: 'fs',
        root: './storage/media',
        // Required for the fs driver: it has no way to derive a public URL on its
        // own, so url() throws without this. Point it at whatever path your server
        // serves ./storage/media from (e.g. express.static).
        baseUrl: 'http://localhost:3000/media',
      },
    },
  },
  models: {
    User: {
      collections: {
        avatar: collection()
          .singleFile()
          .acceptsMimeTypes(['image/*'])
          .conversions({
            // .nonQueued() runs it inline, so the URL is valid the moment add() resolves
            thumb: conversion().width(96).height(96).fit('cover').format('webp').nonQueued(),
          }),
      },
    },
  },
})
```

```ts
import { library } from './media.js'

const media = await library.for('User', 'user-1').add('/tmp/upload.png').toCollection('avatar')

media.id //  '0e5f…'    — the media record id
media.mimeType //  'image/png' — sniffed from the bytes, not from the filename

await library.for('User', 'user-1').firstUrl('avatar') //  original
await library.for('User', 'user-1').firstUrl('avatar', 'thumb') //  96×96 webp
```

Three things happened that are worth naming, because they're the whole point of the library:

1. The file was **validated against the collection**, not against ad-hoc checks at the call site.
2. The `thumb` conversion was **derived and stored automatically**, because the collection declares it.
3. Because `avatar` is `singleFile()`, the previous avatar (and every file derived from it) was
   **deleted** — you never write cleanup code.

> A filesystem-path source is **moved**, not copied — the temp file at `/tmp/upload.png` is consumed.
> Call `.preservingOriginal()` if you need it to survive.

---

# Recipes

## 1. User avatars — one file, auto-thumbnail, fallback image

The classic case: one avatar per user, replaced on upload, with a default image for users who never
set one.

```ts
avatar: collection()
  .singleFile()
  .acceptsMimeTypes(['image/jpeg', 'image/png', 'image/webp'])
  .fallbackUrl('https://cdn.example.com/defaults/avatar.png')
  .conversions({
    thumb: conversion().width(96).height(96).fit('cover').format('webp').nonQueued(),
    large: conversion().width(512).height(512).fit('cover').format('webp'),
  })
```

```ts
await library.for('User', user.id).add(file).toCollection('avatar')

// Empty collection? You get the fallback, not null — so templates need no branching.
const url = await library.for('User', user.id).firstUrl('avatar', 'thumb')
```

**Details that matter here:**

- `.fallbackUrl(url)` with no conversion name backs **every** conversion-scoped lookup, so
  `firstUrl('avatar', 'thumb')` returns it too. Register a per-conversion fallback with
  `.fallbackUrl(url, 'thumb')` when you want a differently-sized default.
- `thumb` is `.nonQueued()` and `large` is not: the small one is ready when `add()` resolves, the big
  one goes through the queue. With the default sync driver both run inline; the split starts to matter
  once you [add a real queue](#5-getting-conversions-off-the-request-path).
- `acceptsMimeTypes` is checked against the **sniffed** MIME type. A `.png` file that is actually a
  PHP script is rejected here, not discovered later.

## 2. Product galleries — ordering, responsive `srcset`, keep-latest

Many files per product, drag-to-reorder in the admin, and a `srcset` for the storefront.

```ts
gallery: collection()
  .onlyKeepLatest(20)
  .acceptsMimeTypes(['image/*'])
  .withResponsiveImages() // variant set + LQIP for every original
  .conversions({
    card: conversion().width(400).height(400).fit('cover').format('webp'),
    hero: conversion().width(1600).format('webp').withResponsiveImages(),
  })
```

```ts
const gallery = library.for('Product', product.id)

await gallery.add(file).usingName('Front view').toCollection('gallery')

// Reorder — ids not owned by this product are filtered out, so a tampered
// payload can't renumber someone else's media.
await gallery.reorder([mediaC.id, mediaA.id, mediaB.id])

const images = await gallery.getAll('gallery') // in order
```

Rendering with responsive images:

```ts
const media = images[0]

const srcset = await library.srcset(media.id) // 'https://…_1600_1200.jpg 1600w, …'
const heroSrcset = await library.srcset(media.id, 'hero') // variants of the hero conversion
const lqip = await library.placeholder(media.id) // 'data:image/svg+xml;base64,…'
const urls = await library.responsiveUrls(media.id) // widest-first array
```

```html
<img
  src="{{ cardUrl }}"
  srcset="{{ srcset }}"
  sizes="(max-width: 700px) 100vw, 700px"
  style="background-image: url('{{ lqip }}'); background-size: cover"
/>
```

`onlyKeepLatest(20)` prunes the oldest beyond 20 on every add, stored files included. Use
`singleFile()` or `onlyKeepLatest(n)` — they're mutually exclusive and the builder throws if you set
both.

**Backfilling:** turning `.withResponsiveImages()` on for a collection that already has media doesn't
retroactively generate anything. Run
[`regenerate({ withResponsive: true, onlyMissing: true })`](#maintenance-cli).

## 3. Private documents — signed URLs, streamed downloads, bulk ZIP

Invoices, contracts, anything that must not be publicly addressable. Storage is private by default,
so this is the path of least resistance rather than an opt-in hardening step.

```ts
invoices: collection().acceptsMimeTypes(['application/pdf']).useDisk('documents') // a private S3 disk
```

```ts
// A time-limited URL the browser can hit directly (S3/GCS presigned)
const url = await library.for('Invoice', invoice.id).firstSignedUrl('invoices', undefined, {
  expiresIn: '15 mins',
})
```

Or keep the bytes behind your own authorization and stream them:

```ts
// Web-standard Response — works as-is in Hono, Next.js route handlers, Bun, Deno
const res = await library.download(media.id) // Content-Disposition: attachment
const preview = await library.inline(media.id) // …; inline
const thumb = await library.download(media.id, 'thumb') // a specific conversion
```

Bulk export, streamed — no temp file, nothing buffered:

```ts
const docs = await library.for('Invoice', invoice.id).getAll('invoices')
return library.zip(`invoice-${invoice.number}.zip`, docs)
```

Set `customProperties.zipFilenamePrefix` on a record to file it into a folder inside the archive
(`'2024/'` → `2024/invoice.pdf`); the value is sanitized against zip-slip.

> ⚠️ **`signedUrl()` on the `fs` driver does not sign anything.** It falls back to the plain public URL
> and ignores `expiresIn`, because the local driver has no signing mechanism. That's fine in
> development, but don't ship private media on an `fs` disk assuming the URL expires — use S3/GCS, or
> serve the bytes yourself with `download()`/`inline()` behind your own auth check.

## 4. Accepting uploads from Express, Hono, or Next.js

`add()` takes whatever your framework hands you, so there's no adapter layer.

**Hono / Next.js route handlers / Bun / Deno** — a web `File` goes straight in, and `download()`
returns a `Response` you can return:

```ts
// app/api/avatar/route.ts
export async function POST(request: Request) {
  const form = await request.formData()
  const file = form.get('avatar') as File
  const user = library.for('User', session.userId)

  const media = await user.add(file).toCollection('avatar')

  return Response.json({ id: media.id, url: await user.firstUrl('avatar', 'thumb') })
}

// app/api/media/[id]/route.ts
export async function GET(_: Request, { params }: { params: { id: string } }) {
  return library.inline(params.id)
}
```

**Express / Fastify** — pass multer's temp path (or its buffer), and use `toNodeStream()` to bridge the
`Response` back to a Node stream:

```ts
import multer from 'multer'
import { toNodeStream } from '@node-media-library/core'

const upload = multer({ dest: '/tmp/uploads' })

app.post('/avatar', upload.single('avatar'), async (req, res) => {
  // A path source is MOVED into the library, so multer's temp file is cleaned up for you
  const media = await library.for('User', req.user.id).add(req.file.path).toCollection('avatar')
  res.json({ id: media.id })
})

app.get('/media/:id/download', async (req, res) => {
  const response = await library.download(req.params.id)
  response.headers.forEach((value, key) => res.setHeader(key, value))
  toNodeStream(response).pipe(res)
})
```

**Handling rejections.** Every validation failure is a typed error with a stable `code`, so mapping
them to HTTP statuses is mechanical:

```ts
import {
  FileTooLargeError,
  UnacceptableFileError,
  DisallowedExtensionError,
} from '@node-media-library/core'

try {
  await library.for('User', id).add(file).toCollection('avatar')
} catch (err) {
  if (err instanceof FileTooLargeError) return res.status(413).json({ error: err.message })
  if (err instanceof UnacceptableFileError) return res.status(415).json({ error: err.message })
  if (err instanceof DisallowedExtensionError) return res.status(422).json({ error: err.message })
  throw err
}
```

| Error                      | `code`                 | Cause                                                        |
| -------------------------- | ---------------------- | ------------------------------------------------------------ |
| `FileTooLargeError`        | `FILE_TOO_LARGE`       | Over `maxFileSize` (default 10 MiB)                          |
| `UnacceptableFileError`    | `UNACCEPTABLE_FILE`    | Failed `acceptsMimeTypes` / `acceptsFile`                    |
| `DisallowedExtensionError` | `DISALLOWED_EXTENSION` | Blocklisted extension, or outside `allowedExtensions`        |
| `UnknownModelError`        | `UNKNOWN_MODEL`        | `for()` called with a model type that isn't registered       |
| `DownloadFailedError`      | `DOWNLOAD_FAILED`      | URL source: bad status, blocked host, redirect, bad protocol |
| `ConversionFailedError`    | `CONVERSION_FAILED`    | An image generator failed                                    |
| `StorageError`             | `STORAGE_ERROR`        | Unknown disk, or the driver can't build a URL                |

All extend `MediaLibraryError`.

## 5. Getting conversions off the request path

Resizing a 4000×3000 photo into four formats inside the request is how upload endpoints get slow. The
default `syncDriver()` runs conversions inline — fine for small images and tests. Swap in BullMQ and
they become background jobs.

```ts
// media.config.ts — shared by BOTH processes
import { prismaAdapter } from '@node-media-library/prisma'
import { bullmqDriver } from '@node-media-library/bullmq'

const connection = { url: process.env.REDIS_URL! }

export const config = {
  repository: prismaAdapter(prisma),
  storage: {/* … */},
  models: {/* … */},
  queue: bullmqDriver({ connection }),
}
```

```ts
// web.ts — add() returns as soon as the original is stored
import { createMediaLibrary } from '@node-media-library/core'
import { config } from './media.config.js'

export const library = createMediaLibrary(config)
```

```ts
// worker.ts — a separate long-lived process
import { createMediaLibrary } from '@node-media-library/core'
import { bullmqDriver } from '@node-media-library/bullmq'
import { config } from './media.config.js'

createMediaLibrary({
  ...config,
  queue: bullmqDriver({ connection: { url: process.env.REDIS_URL! }, workerConcurrency: 4 }),
})
// Registering the processor happens in the constructor. Keep the process alive.
```

The worker **must be built from the same model/collection config** as the web process — that's where
conversion definitions live, and a worker that doesn't know about a collection can't generate its
conversions.

Meanwhile, conversions you want available immediately (a small thumbnail for the optimistic UI) stay
`.nonQueued()` and still run inline. Watch progress through typed events:

```ts
library.events.on('conversion:completed', ({ media, conversion }) => {
  logger.info({ mediaId: media.id, conversion }, 'conversion ready')
})
library.events.on('conversion:failed', ({ media, conversion, error }) => {
  logger.error({ mediaId: media.id, conversion, error }, 'conversion failed')
})
```

Full event map: `media:added`, `media:deleting`, `media:deleted`, `media:copied`, `media:moved`,
`collection:cleared`, `conversion:started|completed|failed`, `responsive:generated|failed`.
`events.on()` returns an unsubscribe function.

## 6. Thumbnails for PDFs and videos

Core only knows how to read images. PDF and video support is **explicit** — append a generator; there
is no auto-detection.

```ts
import {
  createMediaLibrary,
  sharpImageGenerator,
  collection,
  conversion,
} from '@node-media-library/core'
import { pdfImageGenerator } from '@node-media-library/pdf'
import { videoImageGenerator } from '@node-media-library/video'

createMediaLibrary({
  // …
  imageGenerators: [sharpImageGenerator(), pdfImageGenerator(), videoImageGenerator()],
  models: {
    Lesson: {
      collections: {
        material: collection().conversions({
          cover: conversion().width(600).pdfPageNumber(1).videoFrameAtSecond(3),
        }),
      },
    },
  },
})
```

One conversion definition serves both: `pdfPageNumber` is read when the source is a PDF,
`videoFrameAtSecond` when it's a video, and neither applies to a plain image. Both generators also feed
`.withResponsiveImages()` — the source is rasterized once and variants derive from that raster.

If **no** configured generator supports a file's MIME type, its conversions are skipped silently and
the upload still succeeds: a `.zip` in an `attachments` collection is stored and downloadable, it just
has no thumbnail. Requires `pdftoppm` / `ffmpeg` on `PATH`.

## 7. Importing a file from a URL, safely

Migrating from another system, or importing a user-supplied avatar URL:

```ts
await library
  .for('User', user.id)
  .add({ url: 'https://cdn.partner.com/photos/42.jpg', allowedHosts: ['cdn.partner.com'] })
  .usingName('Imported photo')
  .toCollection('avatar')
```

`allowedHosts` is an exact `host:port` match, and redirects are rejected outright rather than followed
— so a `302` to an internal address can't slip past the allowlist. The download is capped at
`maxFileSize` **while it streams**, and a `Content-Length` header that already exceeds the cap is
rejected before a byte is read.

> This is not a complete SSRF defense. The allowlist checks the hostname you were given; it can't stop
> DNS rebinding, or an allowlisted host that resolves to a private IP. If the URLs come from untrusted
> users, put an egress proxy in front of this.

## 8. Metadata, search, copy and move

Attach your own data to a media record and query by it:

```ts
await library
  .for('Post', post.id)
  .add(file)
  .withCustomProperties({ alt: 'Sunset over the bay', credit: 'A. Photographer', featured: true })
  .toCollection('images')

// Update one key without touching siblings (a dedicated atomic repository
// operation, not a read-modify-write of the whole JSON blob)
await library.setCustomProperty(media.id, 'alt', 'Sunset over the bay, 2024')
await library.removeCustomProperty(media.id, 'credit')

// Filter by exact match…
const featured = await library.for('Post', post.id).getAll('images', { featured: true })
// …or with a predicate
const large = await library.for('Post', post.id).getAll('images', (m) => m.size > 1_000_000)
```

Move media between owners — reassigning a draft's uploads to the published post, or transferring an
asset between accounts:

```ts
const copy = await library.copyMedia(media.id, 'Post', otherPost.id, { toCollection: 'images' })
const moved = await library.moveMedia(media.id, 'Post', otherPost.id)
```

Both re-run the full add pipeline on the target, so the **target's** validation, disk, and collection
rules apply, and derived files are regenerated rather than byte-copied. `moveMedia` is
copy-then-delete: if the copy fails, the source is untouched.

---

# Production

## Persistence with Prisma

`InMemoryMediaRepository` is for tests. For real use, add the `Media` model to your schema and pass the
adapter:

```prisma
model Media {
  id                   String   @id
  modelType            String
  modelId              String
  uuid                 String   @unique
  collectionName       String
  name                 String
  fileName             String
  mimeType             String?
  disk                 String
  conversionsDisk      String?
  size                 Int
  manipulations        Json
  customProperties     Json
  generatedConversions Json
  responsiveImages     Json
  orderColumn          Int?
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  @@index([modelType, modelId])
  @@map("media")
}
```

```ts
import { prismaAdapter, withMediaCascade } from '@node-media-library/prisma'

const library = createMediaLibrary({ repository: prismaAdapter(prisma) /* … */ })

// Opt-in: deleting a User now deletes its media rows AND their stored files
const db = withMediaCascade(prisma, library)
await db.user.delete({ where: { id: userId } })
```

Media rows are **not** foreign-keyed to your models — that's what lets `modelType`/`modelId` work across
every table. Without `withMediaCascade`, deleting an owner leaves its media behind; recover those with
`clean({ deleteOrphaned: true })`. See [`packages/prisma/README.md`](packages/prisma/README.md),
including its honest note on JSON-column merge atomicity under Postgres/MySQL.

Any backend works — implement `MediaRepository` and validate it against the shared contract suite
exported from `@node-media-library/core/testing`, which every bundled adapter also runs.

## Storage disks

`fs`, `s3`, and `gcs`, with per-collection routing:

```ts
storage: {
  disks: {
    default:   { driver: 'fs', root: './storage/media', baseUrl: 'http://localhost:3000/media' },
    public:    { driver: 's3', bucket: 'assets',    region: 'us-east-1', visibility: 'public' },
    documents: { driver: 's3', bucket: 'documents', region: 'us-east-1' }, // private
  },
}

// then, per collection:
invoices: collection().useDisk('documents').storeConversionsOnDisk('documents')
```

With no `storage` config at all, the default disk is synthesized from the environment:
`MEDIA_S3_BUCKET` → S3, else `MEDIA_GCS_BUCKET` → GCS, else local fs at `MEDIA_FS_ROOT` (default
`./storage/media`). Handy for a twelve-factor deploy; explicit config is clearer.

- The **`fs` driver needs `baseUrl`** to produce URLs at all — without it, `url()` throws
  `StorageError`. Serve that root statically and point `baseUrl` at it.
- `s3`/`gcs` also accept a `baseUrl`, but **it is currently ignored** by those drivers; their URLs come
  from the driver's own defaults.
- The `gcs` driver needs the optional peer `@google-cloud/storage ^7.10.2`.
- Files land at `{prefix}/{mediaId}/{fileName}`, with `conversions/` and `responsive/` beside them — so
  one media item is one directory, and deleting it is one recursive delete. Swap `pathGenerator` to
  change that.

## Security defaults

The short version — the full rationale is in
[`packages/core/README.md`](packages/core/README.md#security-model):

- **MIME is sniffed from the bytes**, never taken from a `Content-Type` header or an extension.
- **Filenames are sanitized** (path separators, control characters, and leading dots stripped,
  `basename()` applied) — including names you pass explicitly via `usingFileName()`.
- **Extensions are blocked per dot-segment**, so `evil.php.jpg` is rejected, not just `evil.php`.
- **`maxFileSize` is enforced during accumulation**, so a hostile stream or URL can't exhaust memory
  before the check runs.
- **Storage is private by default.** `collection().public()` opts a collection's writes into public
  ACLs.
- Replacing `fileNameSanitizer` replaces those protections. Extend the default rather than starting
  from scratch.

Found a vulnerability? Report it privately per [SECURITY.md](SECURITY.md).

## Maintenance CLI

Point it at a module that default-exports your `MediaLibrary`:

```bash
# Backfill conversions added after the media was uploaded
node-media-library regenerate --config media.config.mjs --model Product --only-missing

# Add responsive variants to media that predate .withResponsiveImages()
node-media-library regenerate --config media.config.mjs --with-responsive --only-missing

# See what a cleanup would remove — orphaned media and stale derived files
node-media-library clean --config media.config.mjs --dry-run --delete-orphaned

# Then do it, at most 10 deletes per second
node-media-library clean --config media.config.mjs --delete-orphaned --rate-limit 10
```

Both are also methods: `library.regenerate({ … })` and `library.clean({ … })`.

> `clean()` is **not** safe to run alongside active conversion workers — it diffs on-disk files against
> config, and a worker writing one mid-diff can cause a spurious or missed delete. Run it offline. It
> also skips (loudly) any record whose model/collection isn't registered in the config you hand it,
> rather than treating every file as stale — so run it with your **full** config.

Running the CLI from a checkout needs `pnpm build` first (the bin points at `dist/`). `.ts` configs need
a loader such as `tsx`.

---

## Packages

Every package is independently publishable and depends only on `@node-media-library/core` — never on a
sibling adapter.

| Package                                                           | What it's for                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`@node-media-library/core`](packages/core/README.md)             | The engine — storage, collections, conversions, responsive images, downloads, CLI. |
| [`@node-media-library/prisma`](packages/prisma/README.md)         | `MediaRepository` backed by Prisma, plus an opt-in cascading-delete extension.     |
| [`@node-media-library/bullmq`](packages/bullmq/README.md)         | `QueueDriver` that dispatches conversions to BullMQ workers.                       |
| [`@node-media-library/pdf`](packages/pdf/README.md)               | `ImageGenerator` rasterizing PDF pages via `pdftoppm`.                             |
| [`@node-media-library/video`](packages/video/README.md)           | `ImageGenerator` extracting video frames via `ffmpeg`.                             |
| [`@node-media-library/optimizers`](packages/optimizers/README.md) | `jpegoptim`/`pngquant` optimizers that shrink conversion and responsive output.    |

## Coming from spatie/laravel-medialibrary

The concepts transfer directly; the API is Node-idiomatic rather than a transliteration.

| Laravel MediaLibrary                        | Here                                                            |
| ------------------------------------------- | --------------------------------------------------------------- |
| `InteractsWithMedia` trait on a model       | Register the model type by name in `models: { User: { … } }`    |
| `$user->addMedia($f)->toMediaCollection()`  | `library.for('User', id).add(f).toCollection()`                 |
| `registerMediaCollections()`                | `collection()` builders in config                               |
| `registerMediaConversions()`                | `conversion()` builders, per collection                         |
| `$user->getFirstMediaUrl('avatar','thumb')` | `await library.for('User', id).firstUrl('avatar', 'thumb')`     |
| `$media->getSrcset()`                       | `await library.srcset(media.id)`                                |
| `media:regenerate` / `media:clean`          | `node-media-library regenerate` / `clean`                       |
| Laravel filesystem disks                    | flydrive disks (`fs` / `s3` / `gcs`)                            |
| Laravel queues                              | `QueueDriver` — `syncDriver()` by default, or BullMQ            |
| Eloquent `Media` model                      | `MediaRepository` interface — Prisma adapter, or bring your own |

**Deliberate differences:**

- **No ORM coupling.** Nothing here knows about your models; you name a `modelType` string and the
  repository stores it. That's what lets one media table serve Prisma, Drizzle, or a raw driver.
- **Everything that touches storage is async.** `firstUrl()`, `srcset()`, and `signedUrl()` return
  promises, because building a URL can mean asking a driver to sign one.
- **Conversions are sharp-based**, not Glide/Imagick, and expose sharp's vocabulary (`fit`, `format`,
  `quality`, `blur`, `greyscale`, `autoOrient`).
- **Downloads are web-standard `Response` objects**, not framework responses — with `toNodeStream()`
  for Express-style servers.
- **No auto-registration.** PDF and video support is an explicit `imageGenerators` entry; optimizers are
  an explicit `optimizers` entry. Nothing is enabled just by installing a package.

## Known limitations

Stated up front, because finding these out in production is worse:

- **Concurrent `add()` calls to the same collection race.** Sibling lists are read without locking, so
  two simultaneous uploads to a `singleFile()` collection can briefly both persist. Serialize per
  (model, collection) if you need a hard guarantee.
- **Prisma JSON-column merges aren't lock-safe** under Postgres/MySQL read-committed isolation — two
  concurrent merges on the _same_ record can lose a write. SQLite is unaffected (single writer).
- **`@node-media-library/video` buffers the whole source video in memory** and spawns one `ffmpeg`
  process per frame extraction. Fine for typical clips; not tuned for large files or many video
  conversions per item.
- **`signedUrl()` doesn't sign on the `fs` driver** — see
  [recipe 3](#3-private-documents--signed-urls-streamed-downloads-bulk-zip).
- **`baseUrl` is ignored by the `s3`/`gcs` drivers**, so a custom CDN hostname needs a custom
  `UrlGenerator` for now.
- **`clean()` is not concurrency-safe** with running workers — see [Maintenance CLI](#maintenance-cli).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers prerequisites, the optional binaries the gated suites need,
scoping tests to one package, and the conventions enforced in review — including that docs must match
shipped behavior, and that repository changes go through the shared contract suite.

```bash
pnpm install       # pnpm only — npm ignores publishConfig.exports and would ship a broken tarball
pnpm -r test       # every package (binary/Redis-gated suites skip without their prerequisite)
pnpm -r typecheck
pnpm build
```

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). The original design spec lives
at [`docs/superpowers/specs/`](docs/superpowers/specs/).

## License

MIT — see [LICENSE](LICENSE).
