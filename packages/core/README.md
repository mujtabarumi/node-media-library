# @node-media-library/core

Node.js port of [spatie/laravel-medialibrary](https://github.com/spatie/laravel-medialibrary) — manage media files (images, documents, etc.) for your application models.

> **Pre-release**: Not yet published to npm. The v1 surface covers file upload, storage, retrieval,
> collection organization, image conversions, responsive images, queue-backed dispatch, downloads/ZIP, a CLI, and
> offline maintenance (`clean()`). PDF/video conversion generators live in `@node-media-library/pdf` and
> `@node-media-library/video`. Some design-spec surface didn't make v1 — see [Roadmap](#roadmap) below.

## Installation

Once published:
```bash
pnpm add @node-media-library/core
```

## Quick Start

```typescript
import { createMediaLibrary, InMemoryMediaRepository, collection, conversion } from '@node-media-library/core'
import { join } from 'node:path'

const library = createMediaLibrary({
  repository: new InMemoryMediaRepository(),
  storage: { disks: { default: { driver: 'fs', root: join(process.cwd(), 'media') } } },
  // Default `queue` is `syncDriver()` (inline). Swap in `bullmqDriver({ connection })`
  // from `@node-media-library/bullmq` to dispatch queued conversions to a worker.
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
const file = await import('node:fs/promises').then(fs => fs.readFile('photo.png'))
const media = await library.for('User', userId).add(file).usingName('Avatar').toCollection('avatar')

// Retrieve files
const all = await library.for('User', userId).getAll()
const url = await library.for('User', userId).firstUrl('avatar')
const thumbUrl = await library.for('User', userId).firstUrl('avatar', 'thumb')

// Manage collections
await library.for('User', userId).reorder([mediaId2, mediaId1])
await library.for('User', userId).clear('gallery')
```

## Responsive images

Opt in per collection, per conversion, or per upload:

```typescript
collection().withResponsiveImages()                                   // every original gets variants
conversion().width(400).format('webp').withResponsiveImages()         // + variants for this conversion
library.for('User', userId).add(file).withResponsiveImages()          // one-off, even without collection opt-in
```

When enabled, a set of progressively narrower variants is generated for the original file (stored under the
pseudo-conversion name `'original'`) and/or any conversion that opts in, alongside an optional low-quality
placeholder (LQIP).

Read the results with:

```typescript
const srcset = await library.srcset(media.id)               // 'url1 1600w, url2 1120w, ...' — original variants
const previewSrcset = await library.srcset(media.id, 'preview') // variants for the 'preview' conversion
const urls = await library.responsiveUrls(media.id)          // widest-first URL array
const placeholder = await library.placeholder(media.id)      // 'data:image/svg+xml;base64,...' or null
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
await library.regenerate({ withResponsive: true })               // (re)generate for every eligible record
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
  responsive variants) with `{ visibility: 'public' }` so the underlying disk driver applies public ACLs/
  permissions at write time — it does not change which URL-generation method you call.

## CLI

The package ships a `node-media-library` bin with `regenerate` and `clean` commands. It expects a config module
that default-exports a `MediaLibrary` instance:

```bash
node-media-library regenerate --config media.config.mjs --model User --only-missing --with-responsive
node-media-library clean --config media.config.mjs --dry-run --delete-orphaned --rate-limit 10
```

Running the CLI from a checkout of this repo (rather than an installed package) requires `pnpm build` first —
the bin points at `./dist/cli.js`, which is only produced by the build step, not present in `src/`. `.ts` configs
need to be executed with a TypeScript loader such as `tsx`.

## Roadmap

**Current**: File upload, storage, retrieval, collections, image conversions, responsive images, queue-backed dispatch (sync and BullMQ), Prisma adapter, PDF/video image generators, downloads/ZIP, CLI, offline maintenance (`clean()`).

**Not yet implemented** (part of the original design spec, deferred rather than cut):
- Media-level `move(toType, toId, collection?)`, `copy(...)`, and `setCustomProperty(...)` — see the design spec's §7 for the intended shape. Workaround today: delete + re-`add()`, or update `customProperties` via the repository directly.
- A GCS (Google Cloud Storage) disk driver — only `fs` and `s3` are wired up in `DiskConfig`. flydrive itself supports GCS; adding it here is just missing glue code.

**Remaining**: Publish to npm.

## License

MIT
