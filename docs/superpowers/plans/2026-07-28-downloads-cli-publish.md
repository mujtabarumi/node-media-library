# Downloads, ZIP, CLI & Publish Prep Implementation Plan (Plan 6 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the last spec sections — streamed downloads (`Response`), on-the-fly ZIP archives, the `regenerate`/`clean` CLI — plus the deferred responsive-hygiene fixes and everything the packages need to be publishable on npm (build pipeline, publishConfig, LICENSE, CI).

**Architecture:** Downloads return Web-standard `Response` objects whose bodies stream straight from FlyDrive (`disk.getStream` → `Readable.toWeb`); `toNodeStream()` adapts for Express-style servers. ZIP uses `archiver` (streamed, zip64-capable, no temp files). `clean()` diffs each media's on-disk `conversions/`/`responsive/` listings (FlyDrive `listAll`) against what the current config defines, deleting strays. The CLI is a thin `parseArgs` wrapper (`runCli(argv, deps)`, dependency-injected for tests) over the programmatic `regenerate`/`clean`. Publishing keeps dev-time `exports` pointing at `src/*.ts` and adds per-package `publishConfig` overrides pointing at `dist/` built by `tsc -p tsconfig.build.json`.

**Tech Stack:** TypeScript ESM (`.js` suffixes), `node:stream` Web-stream interop, `archiver` ^7 (new core runtime dep — the spec's sanctioned "zip-streaming lib"), `yauzl` (devDep, test-side zip verification), `node:util` `parseArgs`, GitHub Actions CI.

## Global Constraints

- Node floor `>=20`; flydrive stays `^1.3.0`. No version bumps.
- All imports use explicit `.js` suffixes; `MediaEventMap` stays an `interface`.
- New runtime dependency allowed in THIS plan only: `archiver` ^7 in core (spec §11 sanctions a zip-streaming lib). `yauzl` + `@types/archiver` + `@types/yauzl` are devDeps. Nothing else.
- Web `Response`/`ReadableStream` are Node-20 globals — never import them from `undici`.
- Test commands: `pnpm --filter @node-media-library/core test` (optionally `-- <file>`); typecheck `pnpm -r typecheck`; full suite `pnpm -r test` (bullmq/pdf/video gated suites skip locally — expected).
- Commit after every task; conventional messages; stage files explicitly, never `git add -A`.
- FlyDrive Disk API available (verified against `node_modules/flydrive/build/src/disk.d.ts`): `put`, `getBytes`, `getStream`, `getMetaData`, `listAll`, `exists`, `delete`, `deleteAll`, `getUrl`, `getSignedUrl`. Check exact signatures in that file before using `listAll`/`getMetaData` — adapt option shapes to what the types say; the behavior specified here is the contract.

## Design decisions (made at planning time)

- **ZIP lib = `archiver`**: mature, streams from arbitrary Readables, zip64 for >4 GB archives. `yazl`/`fflate` rejected (no zip64 / lower-level API).
- **CLI config loading**: plain dynamic `import()` of the `--config` file; it must be loadable by Node directly (`.mjs`/`.js`, or run the CLI under `tsx` for `.ts` configs). No jiti/bundler dep. The config's default export must be the `MediaLibrary` instance (duck-checked, not `instanceof`).
- **`clean()` is an offline maintenance op**: it read-modify-writes `generatedConversions`/`responsiveImages` via `repository.update` and diffs disk listings; running it concurrently with active conversion workers is documented as unsupported (same posture as Spatie).
- **Deferred-minor payoff folded in** (Plan-4 ledger): stale responsive variant files are now deleted on regenerate, and `responsive:failed` joins the event map — this is the last plan, nothing stays "for later".
- **Publish shape**: dev `exports` keep `./src/*.ts` (workspace tests depend on it); `publishConfig.exports` overrides to `dist/` at pack time (pnpm applies it). `files: ["dist", "README.md", "LICENSE"]`, `prepublishOnly: "pnpm build"` per package.

## File Structure

- Create: `packages/core/src/downloads/response.ts` — `toNodeStream`, `contentDisposition`
- Create: `packages/core/src/downloads/zip.ts` — archiver plumbing
- Create: `packages/core/src/cli/run.ts` — `runCli` (testable core), `packages/core/src/cli.ts` — bin wrapper
- Create: `packages/core/src/maintenance/clean.ts` — clean types + rate gate
- Modify: `packages/core/src/library.ts` — `download`/`inline`/`zip`/`clean` methods
- Modify: `packages/core/src/conversions/engine.ts` + `src/events.ts` — responsive hygiene + `responsive:failed`
- Modify: `packages/core/src/index.ts`, `packages/core/package.json`
- Modify (publish prep): every `packages/*/package.json`, new `packages/*/tsconfig.build.json`, `LICENSE` files, root `package.json`/`README.md`, `.github/workflows/ci.yml`, `packages/prisma/src/schema.ts` + README notes

---

### Task 1: Streamed downloads — `download()`, `inline()`, `toNodeStream()`

**Files:**
- Create: `packages/core/src/downloads/response.ts`
- Modify: `packages/core/src/library.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './downloads/response.js'`)
- Test: `packages/core/test/downloads.test.ts`

**Interfaces:**
- Consumes: `requireMedia` (private, library.ts), `engine.applicable`/`engine.effectiveFormat`, `conversionFileName` from `./conversions/naming.js`, `pathGenerator`, `storage.disk`, `MediaLibraryError`.
- Produces:
  - `toNodeStream(response: Response): Readable` — wraps `Readable.fromWeb(response.body)`; throws `MediaLibraryError` when the body is null.
  - `contentDisposition(kind: 'attachment' | 'inline', fileName: string): string` — ASCII-sanitized filename (spec §11): every char outside printable ASCII, plus `"` and `\`, becomes `_`; returns e.g. `attachment; filename="photo_1.jpg"`.
  - `MediaLibrary.download(mediaOrId: MediaRecord | string, conversionName?: string): Promise<Response>` and `MediaLibrary.inline(...)` — same resolution rules as URL generation: a **generated** conversion streams the conversion file from `conversionsDisk ?? disk` with the effective-format file name; anything else falls back to the original. Headers: `Content-Type` (conversion: `image/{format}` when the effective format is set, else the media's mimeType; original: media's mimeType, omitted when null), `Content-Length` (original only: `String(media.size)`), `Content-Disposition` via `contentDisposition` with the streamed file's actual name.

- [ ] **Step 1: Write failing tests** in `packages/core/test/downloads.test.ts`. Reuse the scaffolding style of `packages/core/test/responsive-urls.test.ts` (in-memory repo + fs disk in a temp dir; sharp-built jpeg; collection with a nonQueued `thumb` conversion, `format('webp')`). Cases, each a real `it()`:

```ts
// 1. download(media.id): Response with status 200; header Content-Type 'image/jpeg',
//    Content-Length equal to String(media.size), Content-Disposition
//    `attachment; filename="<fileName>"`; awaiting response.arrayBuffer() yields
//    exactly the uploaded bytes
// 2. inline(media.id): Content-Disposition starts with `inline; filename=`
// 3. download(media.id, 'thumb') after generation: body bytes equal the on-disk
//    conversion file; Content-Type 'image/webp'; Content-Disposition names the
//    conversion file (photo-thumb.webp); NO Content-Length header
// 4. download(media.id, 'thumb') BEFORE generation (wipe generatedConversions via
//    repository.update): falls back to the original bytes + original headers
// 5. download('nope') rejects with MediaLibraryError
// 6. toNodeStream(await media.download(id)) collects to the original bytes
//    (for await chunks); toNodeStream(new Response(null)) throws MediaLibraryError
// 7. contentDisposition('attachment', 'naïve "file".jpg') === 'attachment; filename="na_ve __file_.jpg"'
```

- [ ] **Step 2: Run to verify failure**: `pnpm --filter @node-media-library/core test -- downloads` → FAIL.

- [ ] **Step 3: Implement** `packages/core/src/downloads/response.ts`:

```ts
import { Readable } from 'node:stream'
import { MediaLibraryError } from '../errors.js'

/** Adapter for Node-stream servers (Express/Fastify): `response.body` as a Readable. */
export function toNodeStream(response: Response): Readable {
  if (!response.body) {
    throw new MediaLibraryError('Response has no body to stream')
  }
  return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
}

/**
 * `Content-Disposition` value with an ASCII-sanitized filename (spec §11):
 * printable ASCII only, `"` and `\` replaced too, so the header never needs
 * escaping or RFC 5987 encoding.
 */
export function contentDisposition(kind: 'attachment' | 'inline', fileName: string): string {
  const safe = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `${kind}; filename="${safe}"`
}
```

- [ ] **Step 4: Implement the library methods** in `packages/core/src/library.ts` (import `contentDisposition` from `./downloads/response.js` and `Readable` from `node:stream`; `conversionFileName` is already imported):

```ts
  /**
   * Web-standard Response streaming the file from storage — works natively in
   * Hono/Next/Bun/Deno; use toNodeStream() for Express-style servers. A
   * generated conversion streams its derived file; an unknown/ungenerated
   * conversionName gracefully falls back to the original (mirrors url()).
   */
  async download(mediaOrId: MediaRecord | string, conversionName?: string): Promise<Response> {
    return this.fileResponse('attachment', mediaOrId, conversionName)
  }

  async inline(mediaOrId: MediaRecord | string, conversionName?: string): Promise<Response> {
    return this.fileResponse('inline', mediaOrId, conversionName)
  }

  private async fileResponse(
    kind: 'attachment' | 'inline',
    mediaOrId: MediaRecord | string,
    conversionName?: string,
  ): Promise<Response> {
    const media = await this.requireMedia(mediaOrId)

    let path = this.resolved.pathGenerator.path(media)
    let diskName = media.disk
    let fileName = media.fileName
    let contentType = media.mimeType
    let contentLength: string | null = String(media.size)

    if (conversionName && media.generatedConversions[conversionName] === true) {
      const def = this.engine.applicable(media)[conversionName]
      if (def) {
        const format = this.engine.effectiveFormat(media, def)
        fileName = conversionFileName(media.fileName, conversionName, format)
        path = `${this.resolved.pathGenerator.conversionsPath(media)}/${fileName}`
        diskName = media.conversionsDisk ?? media.disk
        contentType = format ? `image/${format}` : media.mimeType
        contentLength = null // size of derived files isn't tracked on the record
      }
    }

    const disk = await this.resolved.storage.disk(diskName)
    const stream = await disk.getStream(path)

    const headers = new Headers()
    if (contentType) headers.set('Content-Type', contentType)
    if (contentLength) headers.set('Content-Length', contentLength)
    headers.set('Content-Disposition', contentDisposition(kind, fileName))

    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers })
  }
```

(If `Readable.toWeb`'s return type needs a cast to the global `ReadableStream`, cast — the runtime types are compatible.)

- [ ] **Step 5: Export** — add `export * from './downloads/response.js'` to `packages/core/src/index.ts`; extend `packages/core/test/exports.test.ts` with `toNodeStream`, `contentDisposition` following its pattern.

- [ ] **Step 6: Run**: `pnpm --filter @node-media-library/core test` → all PASS.

- [ ] **Step 7: Commit**:

```bash
git add packages/core/src/downloads/response.ts packages/core/src/library.ts packages/core/src/index.ts packages/core/test/downloads.test.ts packages/core/test/exports.test.ts
git commit -m "feat(core): streamed download/inline responses with toNodeStream helper"
```

---

### Task 2: Streamed ZIP archives

**Files:**
- Modify: `packages/core/package.json` (deps: `"archiver": "^7.0.1"`; devDeps: `"@types/archiver": "^6.0.2"`, `"yauzl": "^3.1.3"`, `"@types/yauzl": "^2.10.3"`) — run `pnpm install` after
- Create: `packages/core/src/downloads/zip.ts`
- Modify: `packages/core/src/library.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/zip.test.ts`

**Interfaces:**
- Consumes: Task 1's `contentDisposition`; `requireMedia`; `pathGenerator.path`; `storage.disk`.
- Produces:
  - `zipEntryName(fileName: string, prefix: string, taken: Set<string>): string` (pure, in zip.ts) — `${prefix}${fileName}`; on collision inserts `-2`, `-3`, … before the extension (`photos/a.jpg` → `photos/a-2.jpg`); adds the result to `taken`.
  - `MediaLibrary.zip(archiveName: string, items: Array<MediaRecord | string>): Promise<Response>` — streamed ZIP (no temp file, mixed disks fine); per-item folder prefix from `customProperties.zipFilenamePrefix` (string, used verbatim — callers include the trailing `/`); headers `Content-Type: application/zip` + `Content-Disposition` attachment with the sanitized archive name.

- [ ] **Step 1: Add the dependencies** to `packages/core/package.json` exactly as listed above; `pnpm install`.

- [ ] **Step 2: Write failing tests** in `packages/core/test/zip.test.ts`. Unzip verification helper using yauzl:

```ts
import yauzl from 'yauzl'

/** Entry-name → content map, via yauzl (buffer mode). */
function readZip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err)
      const entries = new Map<string, Buffer>()
      zip.on('entry', (entry) => {
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return reject(streamErr)
          const chunks: Buffer[] = []
          stream.on('data', (c) => chunks.push(c))
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks))
            zip.readEntry()
          })
        })
      })
      zip.on('end', () => resolve(entries))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}
```

Cases (fs disk, two added jpegs `a.jpg` and `b.jpg`, distinct bytes):

```ts
// 1. zip('archive.zip', [idA, idB]) → status 200, Content-Type application/zip,
//    Content-Disposition 'attachment; filename="archive.zip"';
//    readZip(Buffer.from(await response.arrayBuffer())) has entries 'a.jpg' and
//    'b.jpg' with the exact source bytes
// 2. zipFilenamePrefix: add a third media with
//    .withCustomProperties({ zipFilenamePrefix: 'photos/' }) → entry named 'photos/<fileName>'
// 3. duplicate names: two media both named 'a.jpg' → entries 'a.jpg' AND 'a-2.jpg'
// 4. zip with an unknown id rejects with MediaLibraryError (fail fast, before streaming)
// 5. zipEntryName pure cases: no collision passthrough; collision → '-2' before extension;
//    extensionless collision 'file' → 'file-2'
```

- [ ] **Step 3: Run to verify failure**: `pnpm --filter @node-media-library/core test -- zip` → FAIL.

- [ ] **Step 4: Implement** `packages/core/src/downloads/zip.ts`:

```ts
import { extname, basename } from 'node:path'

/**
 * Entry name inside the archive: `${prefix}${fileName}`, deduplicated against
 * `taken` by inserting `-2`, `-3`, ... before the extension. Mutates `taken`.
 */
export function zipEntryName(fileName: string, prefix: string, taken: Set<string>): string {
  const base = `${prefix}${fileName}`
  let candidate = base
  let n = 2
  while (taken.has(candidate)) {
    const ext = extname(fileName)
    const stem = basename(fileName, ext)
    candidate = `${prefix}${stem}-${n}${ext}`
    n += 1
  }
  taken.add(candidate)
  return candidate
}
```

- [ ] **Step 5: Implement `MediaLibrary.zip`** in `packages/core/src/library.ts`:

```ts
  /**
   * Streamed ZIP of `items` (records or ids, mixed disks fine) — no temp
   * file; entries stream from storage as the archive streams out. Foldering:
   * a string `customProperties.zipFilenamePrefix` is prepended verbatim to
   * that item's entry name. Not for concurrent mutation: items deleted while
   * the archive streams will abort the response stream.
   */
  async zip(archiveName: string, items: Array<MediaRecord | string>): Promise<Response> {
    const archiver = (await import('archiver')).default
    // Resolve everything (and fail fast on unknown ids) BEFORE streaming starts.
    const sources = await Promise.all(
      items.map(async (item) => {
        const media = await this.requireMedia(item)
        const disk = await this.resolved.storage.disk(media.disk)
        const stream = await disk.getStream(this.resolved.pathGenerator.path(media))
        return { media, stream }
      }),
    )

    const archive = archiver('zip')
    const taken = new Set<string>()
    for (const { media, stream } of sources) {
      const prefix =
        typeof media.customProperties['zipFilenamePrefix'] === 'string'
          ? (media.customProperties['zipFilenamePrefix'] as string)
          : ''
      archive.append(stream, { name: zipEntryName(media.fileName, prefix, taken) })
    }
    // finalize() resolves when the archive finishes writing; it must not be
    // awaited here (the consumer hasn't started reading yet — awaiting would
    // deadlock on backpressure for large archives). Failures surface by
    // destroying the archive stream, which errors the Response body.
    archive.finalize().catch((err: unknown) => archive.destroy(err instanceof Error ? err : new Error(String(err))))

    const headers = new Headers({
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition('attachment', archiveName),
    })
    return new Response(Readable.toWeb(archive) as ReadableStream, { status: 200, headers })
  }
```

- [ ] **Step 6: Export** `zipEntryName` (`export * from './downloads/zip.js'` in index.ts); extend exports.test.ts.

- [ ] **Step 7: Run**: `pnpm --filter @node-media-library/core test` → all PASS. `pnpm -r typecheck` → clean.

- [ ] **Step 8: Commit**:

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/src/downloads/zip.ts packages/core/src/library.ts packages/core/src/index.ts packages/core/test/zip.test.ts packages/core/test/exports.test.ts
git commit -m "feat(core): streamed zip archives via archiver with per-item foldering"
```

---

### Task 3: Programmatic `clean()`

**Files:**
- Create: `packages/core/src/maintenance/clean.ts` (types + rate gate)
- Modify: `packages/core/src/library.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/clean.test.ts`

**Interfaces:**
- Consumes: `repository.iterateAll`/`ownerExists`/`update`, `deleteMedia`, `engine.applicable`/`effectiveFormat`, `conversionFileName`, `pathGenerator.conversionsPath`/`responsivePath`, `storage.disk`, disk `listAll`/`delete` (check exact `listAll` signature/return shape in `node_modules/flydrive/build/src/disk.d.ts` and adapt — you need each listed object's key relative to the listed directory, and recursion enabled for fs).
- Produces:
  - `interface CleanOptions { dryRun?: boolean; deleteOrphaned?: boolean; rateLimit?: number }` (rateLimit = max deletions per second across files+records; undefined = unthrottled)
  - `interface CleanResult { orphanedMediaDeleted: number; staleFilesDeleted: number; staleEntriesRemoved: number; dryRun: boolean }`
  - `MediaLibrary.clean(opts?: CleanOptions): Promise<CleanResult>` with behavior:
    1. Iterate every record (`iterateAll()`).
    2. `deleteOrphaned` && `!await repository.ownerExists(...)` → `deleteMedia(record)` (counts in `orphanedMediaDeleted`; skip the remaining steps for that record).
    3. Stale derived files: list the record's `conversions/` dir (on `conversionsDisk ?? disk`) and `responsive/` dir (on `disk`); compute the EXPECTED file set — conversions: `conversionFileName(fileName, name, effectiveFormat)` for each currently-applicable definition; responsive: every `fileName` in every `responsiveImages` entry whose key is `'original'` or a currently-applicable conversion name. Delete listed files not in the expected set (`staleFilesDeleted`). A missing/unlistable directory is fine — treat as empty.
    4. Stale JSON entries: `generatedConversions` keys and `responsiveImages` keys (except `'original'` and `'requested'`) that are no longer applicable get removed via ONE `repository.update` per record carrying both rebuilt maps (`staleEntriesRemoved` counts removed keys); no update call when nothing changed.
    5. `dryRun` counts everything but performs no deletion/update. `rateLimit` throttles actual delete operations (simple gate: spacing of `1000/rateLimit` ms between delete starts).
  - JSDoc documents: offline maintenance op, not safe concurrently with active conversion workers.

- [ ] **Step 1: Write failing tests** in `packages/core/test/clean.test.ts` (fs disk temp scaffolding; in-memory repo constructed with the `ownerExists` callback option). Cases, each a real `it()`:

```ts
// 1. stale conversion file: add media with a 'thumb' conversion (nonQueued, jpeg),
//    then manually write an extra file 'photo-old.jpeg' into the conversions dir;
//    clean() deletes ONLY the stray file (staleFilesDeleted 1); the real
//    thumb file and original remain; generatedConversions untouched
// 2. stale JSON + files after config change: generate under a config with 'thumb',
//    then build a SECOND library over the same repository+storage whose collection
//    has NO conversions; clean() on it deletes the thumb file, removes the
//    generatedConversions.thumb key and any responsiveImages entry for the
//    now-undefined conversion (staleEntriesRemoved >= 1); the original file stays
// 3. deleteOrphaned: repo built with ownerExists: (t, id) => id !== 'gone';
//    media for ('User','gone') is fully deleted (record + directory) only when
//    opts.deleteOrphaned is true; without the flag it survives
// 4. dryRun: true → same counts as the real run would report, but every file,
//    record and JSON key is still present afterwards
// 5. clean() twice → second run reports all-zero counts (idempotent)
```

- [ ] **Step 2: Run to verify failure**: `pnpm --filter @node-media-library/core test -- clean` → FAIL.

- [ ] **Step 3: Implement.** `packages/core/src/maintenance/clean.ts` holds `CleanOptions`, `CleanResult`, and:

```ts
/** Spaces delete operations to at most `perSecond` per rolling second. */
export class DeleteRateGate {
  private lastAt = 0
  constructor(private readonly perSecond: number | undefined) {}

  async wait(): Promise<void> {
    if (!this.perSecond) return
    const interval = 1000 / this.perSecond
    const now = Date.now()
    const earliest = this.lastAt + interval
    if (now < earliest) {
      await new Promise((resolve) => setTimeout(resolve, earliest - now))
    }
    this.lastAt = Date.now()
  }
}
```

`MediaLibrary.clean(opts)` implements the behavior contract above. Listing note: normalize whatever `listAll` returns to plain file names relative to the listed directory before diffing (drivers may return prefixed keys — strip the directory prefix). Guard each `listAll` in try/catch → empty list.

- [ ] **Step 4: Export** `CleanOptions`, `CleanResult`, `DeleteRateGate` via `export * from './maintenance/clean.js'`; extend exports.test.ts.

- [ ] **Step 5: Run**: `pnpm --filter @node-media-library/core test` → all PASS.

- [ ] **Step 6: Commit**:

```bash
git add packages/core/src/maintenance packages/core/src/library.ts packages/core/src/index.ts packages/core/test/clean.test.ts packages/core/test/exports.test.ts
git commit -m "feat(core): programmatic clean() with orphan removal, stale-file diffing and rate limiting"
```

---

### Task 4: Responsive hygiene — stale-variant deletion on regenerate + `responsive:failed` event

**Files:**
- Modify: `packages/core/src/events.ts`
- Modify: `packages/core/src/conversions/engine.ts`
- Test: `packages/core/test/responsive-engine.test.ts` (append)

**Interfaces:**
- Consumes: existing `generateResponsive`, `perform`, `mergeResponsiveImages`, `ResponsiveImagesEntry`.
- Produces:
  - `MediaEventMap` gains `'responsive:failed': { media: MediaRecord; conversion: string; error: unknown }`.
  - `generateResponsive` deletes files from the PREVIOUS entry for that conversion name that are not part of the new variant set — after the new files are written and the merge has landed (readers never see a gap). Each stale delete is individually try/caught (`console.warn` on failure — cleanup must not fail the generation).
  - `perform()`'s original-responsive catch emits `responsive:failed` with conversion `'original'` in BOTH branches (before the rethrow, and alongside the warn). Conversion-scoped responsive failures keep surfacing as that conversion's `conversion:failed` (document with a one-line comment).

- [ ] **Step 1: Write failing tests** appended to `packages/core/test/responsive-engine.test.ts`:

```ts
// 1. stale-variant cleanup: generate original responsive once; then shrink the
//    variant plan by building a second library over the same repo+storage with a
//    custom responsiveWidthCalculator returning exactly one width, re-run
//    perform(id, ['original']); the responsive dir now contains ONLY the new
//    entry's fileNames — the old extra widths' files are gone
// 2. responsive:failed (warn path): a responsiveWidthCalculator that throws +
//    a collection that also defines a working conversion; perform(id) → listener
//    receives { conversion: 'original', error }; perform resolves; conversion
//    still completes
// 3. responsive:failed (rethrow path): same throwing calculator but NO conversions
//    → perform(id, ['original']) rejects AND the event fired first
```

- [ ] **Step 2: Run to verify failure**: `pnpm --filter @node-media-library/core test -- responsive-engine` → FAIL (new cases).

- [ ] **Step 3: Implement.** events.ts: add the member. engine.ts `generateResponsive`: before building new variants, capture `previous` = the current record's `responsiveImages[conversionName]` (fresh `findById`; shape-check for a `files` array); after `mergeResponsiveImages` + event emit, delete `previous.files` entries whose `fileName` is not among the new files (`disk.delete(\`${dir}/${fileName}\`)` each in try/catch-warn). `perform()`: in the runOriginal catch block emit `responsive:failed` before the rethrow/warn.

- [ ] **Step 4: Run**: `pnpm --filter @node-media-library/core test` → all PASS.

- [ ] **Step 5: Commit**:

```bash
git add packages/core/src/events.ts packages/core/src/conversions/engine.ts packages/core/test/responsive-engine.test.ts
git commit -m "feat(core): responsive:failed event and stale variant cleanup on regeneration"
```

---

### Task 5: CLI — `regenerate` + `clean`

**Files:**
- Create: `packages/core/src/cli/run.ts`
- Create: `packages/core/src/cli.ts` (bin wrapper)
- Modify: `packages/core/package.json` (add `"bin": { "node-media-library": "./dist/cli.js" }`)
- Modify: `packages/core/src/index.ts` (`export * from './cli/run.js'`)
- Test: `packages/core/test/cli.test.ts`

**Interfaces:**
- Consumes: `MediaLibrary.regenerate` (`{ modelType?, ids?, only?, onlyMissing?, withResponsive? }` → `{ enqueued }`), Task 3's `clean` (`CleanOptions` → `CleanResult`).
- Produces:
  - `interface CliLibrary { regenerate(opts: RegenerateOptions): Promise<{ enqueued: number }>; clean(opts?: CleanOptions): Promise<CleanResult> }` (duck type — no instanceof)
  - `interface CliDeps { loadLibrary(configPath: string): Promise<CliLibrary>; log(line: string): void; error(line: string): void }`
  - `runCli(argv: string[], deps: CliDeps): Promise<number>` — argv WITHOUT the node/script prefix. Exit codes: 0 success, 1 usage/load/command errors.
  - `defaultLoadLibrary(configPath: string): Promise<CliLibrary>` — dynamic `import(pathToFileURL(resolve(configPath)).href)`, takes `mod.default`, duck-checks `regenerate`/`clean` functions, throws `MediaLibraryError` with a message explaining the config must default-export a MediaLibrary instance (and that `.ts` configs need `tsx`).

- [ ] **Step 1: Write failing tests** in `packages/core/test/cli.test.ts` — pure `runCli` tests with a stubbed `loadLibrary` (capture calls; return canned results). Cases:

```ts
// 1. runCli(['regenerate', '--config', 'media.config.mjs', '--model', 'User',
//    '--ids', 'a,b', '--only', 'thumb,preview', '--only-missing', '--with-responsive'], deps)
//    → loadLibrary called with 'media.config.mjs'; regenerate called with
//    { modelType: 'User', ids: ['a','b'], only: ['thumb','preview'],
//      onlyMissing: true, withResponsive: true }; returns 0; log contains 'Enqueued 3'
//    (stub returns { enqueued: 3 })
// 2. runCli(['clean', '--config', 'c.mjs', '--dry-run', '--delete-orphaned',
//    '--rate-limit', '10']) → clean called with { dryRun: true, deleteOrphaned: true,
//    rateLimit: 10 }; returns 0; log lines include the counts from the stubbed CleanResult
// 3. missing --config → returns 1, error() mentions --config, loadLibrary never called
// 4. unknown command ('frobnicate') and no command → returns 1 + usage via error()
// 5. --rate-limit 'abc' → returns 1 with a clear message
// 6. loadLibrary rejection → returns 1, error() carries the thrown message
```

- [ ] **Step 2: Run to verify failure**: `pnpm --filter @node-media-library/core test -- cli` → FAIL.

- [ ] **Step 3: Implement** `packages/core/src/cli/run.ts` with `node:util`'s `parseArgs` (`allowPositionals: true`; options: `config` string, `model` string, `ids` string, `only` string, `only-missing` boolean, `with-responsive` boolean, `dry-run` boolean, `delete-orphaned` boolean, `rate-limit` string; `strict: true` with parse errors caught → usage + exit 1). Usage text lists both commands and their flags (spec §13 wording). Command dispatch maps flags exactly as the tests specify; `clean` prints one line per `CleanResult` field, `regenerate` prints `Enqueued ${enqueued} regeneration job(s).`; dry-run output lines are prefixed `[dry-run] `.

`packages/core/src/cli.ts`:

```ts
#!/usr/bin/env node
import { runCli, defaultLoadLibrary } from './cli/run.js'

process.exitCode = await runCli(process.argv.slice(2), {
  loadLibrary: defaultLoadLibrary,
  log: (line) => console.log(line),
  error: (line) => console.error(line),
})
```

- [ ] **Step 4: Add the bin field** to `packages/core/package.json` (points at `./dist/cli.js` — built output; Task 6 creates the build. Note in the core README's CLI section that running from the repo requires `pnpm build` first).

- [ ] **Step 5: Run**: `pnpm --filter @node-media-library/core test` → all PASS. `pnpm -r typecheck` → clean.

- [ ] **Step 6: Commit**:

```bash
git add packages/core/src/cli packages/core/src/cli.ts packages/core/package.json packages/core/src/index.ts packages/core/test/cli.test.ts packages/core/test/exports.test.ts
git commit -m "feat(core): node-media-library CLI with regenerate and clean commands"
```

---

### Task 6: Publish preparation — build pipeline, manifests, LICENSE, CI, doc honesty

**Files:**
- Create: `packages/{core,prisma,bullmq,pdf,video}/tsconfig.build.json` + per-package `LICENSE` (and root `LICENSE`)
- Modify: all five `packages/*/package.json`, root `package.json`, root `README.md` (create if absent), `.gitignore` (ignore `dist`)
- Modify: `packages/prisma/src/schema.ts` + `packages/prisma/README.md` (size/BigInt + nulls-ordering notes)
- Create: `.github/workflows/ci.yml`
- Modify: `packages/pdf/test/integration.test.ts` (tighten variant regex to `\.png$` — CI runs real binaries)
- Test: full workspace + build smoke

**Interfaces:** consumes everything; produces publishable packages. No new code APIs.

- [ ] **Step 1: Build config.** Per package, `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": false, "outDir": "dist", "rootDir": "src", "declaration": true },
  "include": ["src"]
}
```

Add to each package.json: `"build": "tsc -p tsconfig.build.json"`, `"prepublishOnly": "pnpm build"`. Root package.json: `"build": "pnpm -r build"` and a `"packageManager"` field pinned to the installed pnpm (`pnpm -v`, e.g. `"pnpm@9.15.0"`).

- [ ] **Step 2: Publish manifests.** For each of the five packages add (adjust description/keywords per package):

```json
  "description": "<one-liner per package>",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/mujtabarumi/node-media-library.git" },
  "keywords": ["media-library", "uploads", "conversions"],
  "engines": { "node": ">=20" },
  "files": ["dist", "README.md", "LICENSE"],
  "publishConfig": {
    "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }
  }
```

Core's `publishConfig.exports` additionally maps `"./testing": { "types": "./dist/testing/index.d.ts", "default": "./dist/testing/index.js" }` (dev `exports` keep `./src/*.ts` — workspace tests rely on them). `workspace:*` deps are rewritten by pnpm at publish — leave them.

- [ ] **Step 3: LICENSE.** Root `LICENSE`: MIT, `Copyright (c) 2026 node-media-library contributors`. Copy the identical file into each package directory.

- [ ] **Step 4: Doc honesty (carried pre-publish notes).** `packages/prisma/src/schema.ts`: in `MEDIA_MODEL_SNIPPET`, add a comment line above `size` — `// size Int supports files up to ~2GB; switch to BigInt (and adjust MediaRow) for larger files` (keep the snippet-parity test green — update it if it asserts the exact snippet text). `packages/prisma/README.md`: add both notes — the size/BigInt line, and: ordering uses `orderBy: [{ orderColumn: { sort: 'asc', nulls: 'last' } }]`, verified against SQLite in this repo's suite; run the exported contract suite against your own Postgres/MySQL before relying on it.

- [ ] **Step 5: CI.** `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix: { node: [20, 22] }
    services:
      redis:
        image: redis:7
        ports: ['6379:6379']
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get update && sudo apt-get install -y poppler-utils ffmpeg
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '${{ matrix.node }}', cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r typecheck
      - run: pnpm -r build
      - run: pnpm -r test
        env: { REDIS_URL: 'redis://localhost:6379' }
```

(This is what finally executes the pdf/video binary-gated suites and the bullmq Redis suite — locally they still skip.) Tighten `packages/pdf/test/integration.test.ts`'s responsive-variant regex from `/___original_\d+_\d+\./` to `/___original_\d+_\d+\.png$/` — the Plan-5 fix guarantees `.png` and CI will now prove it.

- [ ] **Step 6: Root README.** Create/replace root `README.md`: what the project is (spatie/laravel-medialibrary for Node), package table (core/prisma/bullmq/pdf/video with one-liners), quickstart pointing at `packages/core/README.md`, dev commands (`pnpm install`, `pnpm -r test`, `pnpm build`), system-binary note for pdf/video, license.

- [ ] **Step 7: Verify.** `pnpm build` → every package emits `dist/` (spot-check `packages/core/dist/index.js` and `dist/cli.js` exist; `node packages/core/dist/cli.js` with no args prints usage and exit code 1). `pnpm -r test` + `pnpm -r typecheck` → green. In `packages/core`: `npm pack --dry-run 2>&1 | head -40` → tarball contains dist/README/LICENSE and NOT src or test.

- [ ] **Step 8: Commit** (`dist/` stays untracked via .gitignore):

```bash
git add .gitignore .github packages/core/package.json packages/prisma/package.json packages/bullmq/package.json packages/pdf/package.json packages/video/package.json packages/core/tsconfig.build.json packages/prisma/tsconfig.build.json packages/bullmq/tsconfig.build.json packages/pdf/tsconfig.build.json packages/video/tsconfig.build.json packages/core/LICENSE packages/prisma/LICENSE packages/bullmq/LICENSE packages/pdf/LICENSE packages/video/LICENSE packages/prisma/src/schema.ts packages/prisma/test packages/prisma/README.md packages/pdf/test/integration.test.ts LICENSE README.md package.json pnpm-lock.yaml
git commit -m "chore: publish pipeline, manifests, license, ci and doc honesty notes"
```

---

## Self-review notes (done at planning time)

- Spec §11 coverage: `download`/`inline` Web Response with Content-Type/Length/Disposition (ASCII-sanitized) ✓ T1; `toNodeStream` ✓ T1; streamed ZIP, no temp file, mixed disks, `zipFilenamePrefix` foldering ✓ T2. Spec §13: `regenerate` flags incl. `--with-responsive` ✓ T5 (programmatic since Plan 4); `clean [--dry-run] [--delete-orphaned] [--rate-limit n]` ✓ T3+T5 with `ownerExists` ✓; both programmatic ✓ (`media.regenerate` existed, `media.clean` T3). Spec §12: `responsive:failed` added T4 — additive to the spec's event list; flag for final review as a deliberate addition. Pre-publish notes all land in T6 (BigInt, nulls:'last' honesty, CI with binaries + Redis, pack shape). Plan-4 deferred minors both closed in T4.
- Placeholder scan: `clean()`'s behavior and the CLI usage text are specified by numbered behavior contracts + test cases rather than full verbatim code — intentional (flydrive `listAll` shape needs on-site adaptation); the tests are the contract. No TBDs.
- Type consistency: `CleanOptions`/`CleanResult` defined T3, consumed T5 (`CliLibrary`) and T6 docs; `contentDisposition` defined T1, consumed T2; `zipEntryName(fileName, prefix, taken)` defined+tested T2; `effectiveFormat`/`applicable` exist on ConversionEngine since Plan 5 and are consumed T1/T3.
- Known risk carried to review: flydrive `listAll` exact signature/return shape (T3) — implementer instructed to read the .d.ts; download/zip `Readable.toWeb` casts.
