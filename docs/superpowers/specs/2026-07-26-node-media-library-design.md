# node-media-library — Design Spec

**Date:** 2026-07-26
**Status:** Approved design, pre-implementation
**Goal:** A public, open-source npm package family that ports the ideas of `spatie/laravel-medialibrary` to Node.js/TypeScript: a polymorphic media table, named collections with rules, image conversions, responsive images, multi-disk storage, and file lifecycle management — ORM-agnostic via adapters.

## 1. Motivation

Research (2026-07-26, against spatie.be v11 docs and package source) confirmed the Node ecosystem has no maintained equivalent: adonis-attachment is AdonisJS-locked with a JSON-column design and no collections; khrykin/attachments is archived; Payload/Keystone media handling is CMS-internal; multer/formidable are ingestion-only. The combination _polymorphic media table + collections + conversions + ORM-agnostic_ is an empty niche.

## 2. Decisions already made

| Decision         | Choice                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| Architecture     | ORM-agnostic core + adapter packages (monorepo)                                                        |
| First DB adapter | Prisma                                                                                                 |
| API style        | Config registry + fluent handle (`media.for(type, id)`) — no classes/decorators required               |
| Storage          | FlyDrive (fs, S3, R2, GCS); S3-first, local-fs fallback; env-driven with package defaults              |
| Visibility       | Private by default; public opt-in per collection; signed _and_ public URLs, caller's per-call choice   |
| v1 scope         | Queued conversions, PDF+video thumbnails, responsive images/srcset, downloads & ZIP streaming — all in |
| Goal             | Publish-grade open-source package                                                                      |

Naming: packages are referred to below as `core`, `prisma`, `bullmq`, `pdf`, `video`. The final npm name/scope is a publish-time decision and does not affect this design.

## 3. Package layout (pnpm monorepo)

| Package  | Contents                                                                                                                                                                                  | Dependencies                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `core`   | Config registry, ingestion pipeline, collections, conversions engine, sharp image generator, responsive images, path/URL generators, events, sync + defer queue drivers, CLI, error types | `flydrive`, `sharp`, `file-type`       |
| `prisma` | `MediaRepository` implementation, paste-in Prisma schema snippet, opt-in client extension for delete cascade                                                                              | peer `@prisma/client`                  |
| `bullmq` | Persistent queue driver                                                                                                                                                                   | peer `bullmq`                          |
| `pdf`    | PDF → image generator                                                                                                                                                                     | `pdf-to-img`                           |
| `video`  | Video frame → image generator                                                                                                                                                             | `execa` (ffmpeg binary user-installed) |

Rules: core has no ORM, HTTP-framework, or queue-infra dependency. sharp is core's only heavy dependency. PDF/video are separate installs. Future adapters (Drizzle, Mongoose, Kysely; pg-boss) are additive packages implementing the same interfaces.

## 4. Configuration & registry

Users write one config file (e.g. `media.config.ts`):

```ts
export const media = createMediaLibrary({
  repository: prismaAdapter(prisma),
  queue: bullmqDriver({ connection: redis }), // optional; default: syncDriver()
  storage: {/* optional; defaults + env override, see §10 */},
  models: {
    User: {
      collections: {
        avatar: collection()
          .singleFile()
          .acceptsMimeTypes(['image/jpeg', 'image/png'])
          .conversions({
            thumb: conversion().width(368).height(232).fit('cover').nonQueued(),
            preview: conversion().width(1200).format('webp').quality(80).withResponsiveImages(),
          }),
      },
    },
  },
})
```

- Definitions compile to plain serializable data → queue workers in other processes re-derive them by importing the same config.
- Unregistered (ad-hoc) collection names are allowed, with no rules and no conversions — parity with Spatie's "simple media collections".
- Collection API: `singleFile()`, `onlyKeepLatest(n)`, `acceptsMimeTypes([...])`, `acceptsFile(cb)`, `useDisk(name)`, `storeConversionsOnDisk(name)`, `public()` (visibility opt-in), `fallbackUrl(url, conversion?)`, `conversions({...})`, `withResponsiveImages()`.

## 5. Data model

One `media` table, owned by this library, created in the host app's migration workflow (Prisma: paste-in model snippet).

| Column                    | Type           | Notes                                                     |
| ------------------------- | -------------- | --------------------------------------------------------- |
| `id`                      | string (cuid)  | PK                                                        |
| `modelType`               | string         | owner model name, as registered in config                 |
| `modelId`                 | string         | owner PK as string — supports int/bigint/uuid/cuid owners |
| `uuid`                    | string, unique | stable public identifier                                  |
| `collectionName`          | string         |                                                           |
| `name`                    | string         | display name (default: filename sans extension)           |
| `fileName`                | string         | name on disk                                              |
| `mimeType`                | string?        | sniffed, never client-trusted                             |
| `disk`                    | string         | disk of original                                          |
| `conversionsDisk`         | string?        | optional separate disk for derived files                  |
| `size`                    | int            | bytes                                                     |
| `manipulations`           | JSON           | per-media conversion overrides                            |
| `customProperties`        | JSON           | arbitrary metadata                                        |
| `generatedConversions`    | JSON           | `{ [conversionName]: boolean }`                           |
| `responsiveImages`        | JSON           | see §9                                                    |
| `orderColumn`             | int?           | sort within (modelType, modelId, collectionName)          |
| `createdAt` / `updatedAt` | datetime       | `updatedAt` powers `?v=` cache busting                    |

Indexes: `(modelType, modelId)`, `uuid` unique.

## 6. Repository interface (per-adapter contract)

```ts
interface MediaRepository {
  create(data: NewMediaRecord): Promise<MediaRecord>
  update(id: string, patch: Partial<MediaRecord>): Promise<MediaRecord>
  findById(id: string): Promise<MediaRecord | null>
  findByUuid(uuid: string): Promise<MediaRecord | null>
  findForModel(modelType: string, modelId: string, collection?: string): Promise<MediaRecord[]>
  delete(id: string): Promise<void> // row only; file deletion is core's job
  setOrder(ids: string[], startAt?: number): Promise<void>
  iterateAll(filter?: MediaFilter): AsyncIterable<MediaRecord> // for regenerate/clean
  ownerExists(modelType: string, modelId: string): Promise<boolean> // for clean --delete-orphaned
}
```

All business logic (collection rules, cascade, ordering semantics) lives in core; adapters are dumb CRUD. A shared exported contract-test suite validates any implementation (§14).

**Delete cascade:** core exposes `media.clearFor(type, id)` for explicit cleanup. The `prisma` package additionally ships an opt-in Prisma client extension intercepting owner `delete`/`deleteMany` to cascade automatically.

## 7. Ingestion pipeline (fluent handle)

```ts
const handle = media.for('User', user.id)
const item = await handle
  .add(source) // string path | Buffer | Readable | web File/Blob | { base64 } | { url }
  .usingName('Profile photo')
  .usingFileName('profile.jpg')
  .withCustomProperties({ tag: 'x' })
  .withManipulations({ thumb: { width: 100 } })
  .preservingOriginal() // copy instead of move (path sources)
  .storingConversionsOnDisk('s3')
  .withResponsiveImages()
  .toCollection('avatar') // executes → MediaRecord
```

Pipeline order: **sniff mime** (magic bytes, `file-type`) → **validate** (global `maxFileSize`; extension blocklist checking _every_ dot-segment so `x.php.jpg` is rejected — default blocklist `php/phtml/phar/htaccess/…`; optional allowlist; collection `acceptsMimeTypes`/`acceptsFile`) → **sanitize filename** (replaceable sanitizer; replacing it replaces blocking too, documented loudly) → **store** via FlyDrive at `{prefix}/{mediaId}/{fileName}` → **insert row** → **emit `media:added`** → **enqueue conversions**. `{ url }` sources document SSRF risk and accept an allowlist option. `singleFile()` / `onlyKeepLatest(n)` displacement deletion happens within the same operation.

Retrieval on the handle: `getAll(collection?, filter?)` (filter: customProperties match or predicate), `first(collection?)`, `firstUrl(collection, conversion?)`, `firstSignedUrl(collection, conversion?, opts?)`, `availableUrl(collection, [conversions])` (first _generated_, else original), `reorder([ids])`, `clear(collection?)`, `delete(mediaId)`. Fallback URL returned for empty collections when configured, else `null`.

Media-level API: `url(conversion?)`, `signedUrl(...)`, `srcset(conversion?)`, `download()/inline()`, `regenerate()`.

**Shipped (Spatie parity):** `media.copyMedia(mediaOrId, toModelType, toModelId, opts?: CopyMediaOptions { toCollection? })` and `media.moveMedia(...)` (same signature) on `MediaLibrary`. Copy re-runs the full add pipeline against the target model/collection — new `id`/`uuid`, target-collection validation/rules/disks govern the result, and conversions + responsive images are **regenerated**, never byte-copied from the source's derived files (matches Spatie's copy semantics: only the original bytes are transferred, everything derived is rebuilt). Move is copy-then-delete-source; if the copy step fails, the source is left untouched. Both emit typed events: `media:copied` (`{ media, copy }`) and `media:moved` (`{ media, moved }`).

`media.setCustomProperty(mediaOrId, key, value)` / `media.removeCustomProperty(mediaOrId, key)` — atomic single-key updates that preserve sibling keys already present in `customProperties`, backed by dedicated repository primitives (both the in-memory and Prisma adapters implement them without a read-modify-write race on the full JSON blob; the per-key lost-update caveat on read-committed SQL still applies (see the Prisma adapter's docs)).

## 8. Conversions engine

- Fluent definition (v1 surface): `width`, `height`, `fit` (sharp's cover/contain/fill/inside/outside + `position`, incl. `attention` smart-crop), `format` (jpeg/png/webp/avif) / `keepOriginalFormat()`, `quality`, `sharpen`, `blur`, `greyscale`, `autoOrient` (default on), `pdfPageNumber(n)`, `videoFrameAtSecond(n)`, `performOnCollections(...)`, `queued()` / `nonQueued()`, `withResponsiveImages()`. Default output format: keep original unless `format()` given.
- Per-media `manipulations` JSON merges over the definition; changing it triggers regeneration.
- Derived files: `{mediaId}/conversions/{fileNameSansExt}-{conversion}.{ext}`, written to `conversionsDisk ?? disk`. `generatedConversions` updated per conversion; URLs gracefully fall back to the original until generated.
- **Queue driver interface:** `enqueue(job)`, `registerProcessor(fn)`, `close()`. Job payload: `{ mediaId, conversionNames }` only — workers reload record + config. Core ships `syncDriver` (default, inline) and `deferDriver` (in-process, post-response). `bullmq` package provides persistence/retries/concurrency. Failed conversions emit `conversion:failed` and leave `generatedConversions[name]` false; retry policy is the driver's concern.

## 9. Image generators & responsive images

**Generator interface:** `supports(mime): boolean`, `toImage(input, conversion): Promise<Buffer>` — converts a non-image into a source image; the sharp pipeline then applies the conversion. An optional `toSourceImage(input): Promise<Buffer>` member renders a plain, conversion-free raster of the source (e.g. PDF page 1, video frame at 0s) for use as the original-responsive source; absent means `input` is already sharp-readable. Core registers the image generator (raster + svg via sharp). `pdf`/`video` packages export generators the user appends via config (`imageGenerators: [sharpImageGenerator(), pdfImageGenerator(), ...]`) — no install-time magic. Custom generators can be appended. Files with no supporting generator skip conversions silently (attachment-only media is fine).

**Responsive images** (opt-in per collection/conversion or per-add):

- Widths from `FileSizeOptimizedWidthCalculator` (port of Spatie's: each variant targets ~70% of previous file size; stop < 10KB predicted or < 20px). Swappable via config.
- Files: `{mediaId}/responsive/{fileNameSansExt}___{conversion}_{w}_{h}.{ext}`; original tracked under pseudo-conversion name `original`.
- `responsiveImages` JSON: `{ [conversion]: { files: [{ fileName, width, height }], placeholder?: base64svg } }` — file names + dimensions, not URLs (disks are private-by-default and URLs may be signed/expiring; URLs are built at read time).
- LQIP: blurred ~32px variant embedded as base64 SVG (default on, can disable).
- API returns data, not HTML: `srcset()` string (real variants only, widest first), `responsiveUrls()`, `placeholder()` (the LQIP data URI, exposed separately — it does not belong inside a `srcset` attribute). Framework view helpers are out of scope for v1.

## 10. Storage, paths, URLs

- **FlyDrive DriveManager** with named disks. Package defaults: if `MEDIA_S3_BUCKET` is set → S3 disk; else if `MEDIA_GCS_BUCKET` is set → GCS disk (S3 takes precedence when both are present); else local fs disk (`MEDIA_FS_ROOT`, default `./storage/media`). Every default overridable via config object or env keys (driver, bucket/root, prefix, region, endpoint, visibility, signed-URL expiry). Warn (not error) when `NODE_ENV=production` runs on the local driver; warning text names the concept, not raw env var names.
  - `gcs` disk config shape: `{ driver: 'gcs', bucket, visibility?='private', usingUniformAcl?, projectId?, keyFilename?, credentials?, baseUrl? }`. Env synthesis fills in only `bucket` (from `MEDIA_GCS_BUCKET`) and defaults `visibility` to `'private'`; the rest are config-only. Requires the optional peer `@google-cloud/storage ^7.10.2`.
- **Visibility:** private by default. `collection().public()` opts a collection into public visibility. Both URL kinds always available where the disk supports them: `url()` (public) and `signedUrl()` (default expiry configurable, per-call override).
- **PathGenerator interface** (swappable): `path(media)`, `conversionsPath(media)`, `responsivePath(media)`. Default: id-based directory per media item, so deletion = remove one directory. Global `prefix` supported.
- **UrlGenerator interface** (swappable): public URL, signed URL, optional `?v={updatedAt}` cache-busting (config `versionUrls`).

## 11. Downloads & ZIP

- `media.download(item, conversion?)` / `media.inline(...)` return **Web-standard `Response`** streaming from FlyDrive with `Content-Type`, `Content-Length`, `Content-Disposition` (ASCII-sanitized filename). Works natively in Hono/Next/Bun/Deno; `toNodeStream(response)` helper ships for Express/Fastify.
- `media.zip('archive.zip', items)` → streamed on-the-fly ZIP (no temp file, mixed disks supported), via a zip-streaming lib; per-item `zipFilenamePrefix` custom property controls in-archive foldering.

## 12. Events

Typed emitter on the library instance: `media:added`, `media:deleting`, `media:deleted`, `collection:cleared`, `conversion:started`, `conversion:completed`, `conversion:failed`, `responsive:generated`. Payloads carry the `MediaRecord` (+ conversion name where relevant).

## 13. CLI & maintenance

`npx <pkg> --config media.config.ts <command>`:

- `regenerate [--model User] [--ids a,b] [--only thumb] [--only-missing] [--with-responsive]` — rebuild derived files via `iterateAll`.
- `clean [--dry-run] [--delete-orphaned] [--rate-limit n]` — delete files for conversions no longer defined; with `--delete-orphaned`, remove media rows whose owner row no longer exists (adapter provides an `ownerExists(type, id)` check).
  Both are also exposed programmatically (`media.regenerate(opts)`, `media.clean(opts)`).

## 14. Errors & testing

**Errors:** `MediaLibraryError` base; subclasses `FileTooLargeError`, `DisallowedExtensionError`, `UnacceptableFileError` (collection rules), `UnknownModelError`, `CollectionNotFoundError` (strict mode only), `ConversionFailedError`, `StorageError`, `DownloadFailedError` (url source).

**Testing:**

- Unit (vitest): pipeline validation, collection rules, width calculator, path/URL generators — fs disk in temp dirs, in-memory repository fake.
- **Exported contract-test suites** for `MediaRepository` and queue drivers; every adapter (present and future) must pass them. Prisma adapter runs against SQLite.
- Integration: full add → convert → responsive → url → delete cycle on fs; S3 path against MinIO (CI) or FlyDrive fake.
- `pdf`/`video` tests gate on binary availability (like Spatie's requirement checks).
- Real image fixtures (jpeg/png/webp/animated gif, EXIF-rotated) checked into the repo.

## 15. Implementation phasing (one release, ordered build)

1. Core skeleton: config registry, repository interface + in-memory fake, media record types, errors, events.
2. Storage layer: FlyDrive integration, env-default disk resolution, path/URL generators, visibility.
3. Ingestion pipeline + collections + retrieval + delete/cascade + ordering.
4. Prisma adapter + schema snippet + contract suite + client extension.
5. Conversions engine (sync driver) + sharp generator + generatedConversions fallback logic.
6. Queue: defer driver, bullmq package, regenerate.
7. Responsive images.
8. PDF + video generator packages.
9. Downloads/ZIP + CLI (`regenerate`, `clean`).
10. Docs site content + README + examples (publish-grade).

## 16. Out of scope for v1

Frontend upload components and temporary-uploads flow (Spatie Pro territory), HTML rendering helpers, Drizzle/Mongoose/Kysely adapters, pg-boss driver, per-model path generator overrides (global swap only in v1).

**Image optimizer seam (shipped, Plan 7):** core exposes an `optimizers?: ImageOptimizer[]` config option (default `[]`) — `ImageOptimizer { name, optimize(buffer, ctx: OptimizeContext): Promise<Buffer | null> }`, `OptimizeContext { format, fileName, media, kind: 'conversion' | 'responsive' }`. Registered optimizers run in order before every conversion/responsive file write; a result is only accepted if it's strictly smaller than the input, an optimizer that throws is warned and skipped (never fails the conversion), and originals/LQIP are never optimized. The `@node-media-library/optimizers` package ships `jpegoptimOptimizer()`/`pngquantOptimizer()` wrapping the `jpegoptim`/`pngquant` SYSTEM binaries (not bundled — install via apt/brew); a missing binary makes the optimizer a no-op (passes the buffer through unchanged, returns `null`).
