# Spatie Parity (Plan 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining spatie/laravel-medialibrary parity gaps: media `copy`/`move`, post-create custom-property mutation, a post-conversion image-optimizer chain, native GCS storage, plus per-reason `clean()` skip counters.

**Architecture:** Custom-property mutation adds two atomic-merge repository primitives mirroring `markConversionGenerated`. `copyMedia` streams the original back through the existing `FileAdder` pipeline (new id → new directory; target-collection validation, single-file displacement, and conversion dispatch all apply for free); `moveMedia` = copy + `deleteMedia` (Spatie semantics — derived files regenerate, never byte-copied). Optimizers are a core seam (`ImageOptimizer[]` in config, applied by the engine immediately before each conversion/responsive `disk.put`) plus a new binary-chain package. GCS is wired into the existing `DiskConfig` union using flydrive's in-package `GCSDriver`.

**Tech Stack:** TypeScript ESM (explicit `.js` import suffixes), vitest, flydrive ^1.3.0 (ships `flydrive/drivers/gcs`), `@google-cloud/storage` ^7.10.2 (optional peer), system binaries `jpegoptim`/`pngquant` via `execFile` (never npm deps, never `shell: true`).

## Global Constraints

- Node floor `>=20`; flydrive pinned `^1.3.0` (2.x needs Node >=24).
- `MediaEventMap` must stay an `interface` (declaration merging); new events are additive members.
- TypeScript ESM: every relative import ends in `.js`.
- `RESERVED_CONVERSION_NAMES = ['original', 'requested']` — never treat these as real conversions.
- Storage private-by-default; public writes only via `writeOptionsFor(collectionDef.public)`.
- Never `git add -A` / `git add .` — stage files explicitly by path.
- Publishing is pnpm-only (`prepack` guard `scripts/ensure-pnpm-pack.mjs`); every new package copies the full publish shape from `packages/pdf/package.json` (exports → `./src/index.ts` in dev, `publishConfig.exports` → dist, `files: ["dist","README.md","LICENSE"]`, `tsconfig.build.json`, MIT LICENSE "node-media-library contributors", `engines >=20`).
- Binary-gated test suites use `describe.runIf(available)` (pattern: `packages/pdf/test/generator.test.ts`); this machine has NO jpegoptim/pngquant — those suites must skip cleanly.
- New runtime behavior needs tests that verify real behavior (real disks/fakes with call capture, not mocks of the unit under test).

---

### Task 1: Repository custom-property primitives

**Files:**
- Modify: `packages/core/src/repository.ts` (interface, currently 34 lines)
- Modify: `packages/core/src/repository/in-memory.ts`
- Modify: `packages/core/src/testing/repository-contract.ts`
- Modify: `packages/prisma/src/adapter.ts` (widen `mergeJsonColumn` at :145-169, add key-removal sibling)

**Interfaces:**
- Consumes: existing `MediaRepository`, `MediaRecord.customProperties: JsonObject`, `MediaLibraryError(msg, 'NOT_FOUND')`, the `mergeJsonColumn` transaction pattern in `packages/prisma/src/adapter.ts:145-169`.
- Produces (Task 2 depends on these exact signatures):
  ```ts
  setCustomProperty(id: string, key: string, value: unknown): Promise<MediaRecord>
  removeCustomProperty(id: string, key: string): Promise<MediaRecord>
  ```
  Semantics: atomic single-key merge/delete on `customProperties` — MUST NOT clobber sibling keys the way `update(id, { customProperties })` does. Unknown id → `MediaLibraryError` code `'NOT_FOUND'`.

- [ ] **Step 1: Add contract cases (failing first)**

In `packages/core/src/testing/repository-contract.ts`, after the existing `mergeResponsiveImages` case (~:199), add — mirroring the style of the `markConversionGenerated` cases at :175-198:

```ts
it('setCustomProperty merges one key without clobbering others', async () => {
  const created = await repo.create(makeRecord({ customProperties: { alt: 'a cat' } }))
  const updated = await repo.setCustomProperty(created.id, 'credit', 'Jane')
  expect(updated.customProperties).toEqual({ alt: 'a cat', credit: 'Jane' })
})

it('setCustomProperty overwrites an existing key in place', async () => {
  const created = await repo.create(makeRecord({ customProperties: { alt: 'old' } }))
  const updated = await repo.setCustomProperty(created.id, 'alt', 'new')
  expect(updated.customProperties).toEqual({ alt: 'new' })
})

it('removeCustomProperty deletes only the named key', async () => {
  const created = await repo.create(makeRecord({ customProperties: { alt: 'a cat', credit: 'Jane' } }))
  const updated = await repo.removeCustomProperty(created.id, 'credit')
  expect(updated.customProperties).toEqual({ alt: 'a cat' })
})

it('removeCustomProperty of a missing key is a no-op', async () => {
  const created = await repo.create(makeRecord({ customProperties: { alt: 'a cat' } }))
  const updated = await repo.removeCustomProperty(created.id, 'nope')
  expect(updated.customProperties).toEqual({ alt: 'a cat' })
})

it('setCustomProperty on unknown id throws NOT_FOUND', async () => {
  await expect(repo.setCustomProperty('missing', 'k', 'v')).rejects.toMatchObject({ code: 'NOT_FOUND' })
})

it('concurrent setCustomProperty calls for different keys both persist', async () => {
  const created = await repo.create(makeRecord())
  await Promise.all([
    repo.setCustomProperty(created.id, 'a', 1),
    repo.setCustomProperty(created.id, 'b', 2),
  ])
  const found = await repo.findById(created.id)
  expect(found?.customProperties).toEqual({ a: 1, b: 2 })
})
```

- [ ] **Step 2: Add the two methods to the `MediaRepository` interface**

In `packages/core/src/repository.ts`, after `mergeResponsiveImages` (:33), with JSDoc matching the atomic-merge honesty style of the neighbors:

```ts
/** Atomically set a single custom property key, preserving sibling keys. */
setCustomProperty(id: string, key: string, value: unknown): Promise<MediaRecord>
/** Atomically remove a single custom property key, preserving sibling keys. */
removeCustomProperty(id: string, key: string): Promise<MediaRecord>
```

- [ ] **Step 3: Run core tests to see the in-memory repo fail to compile/contract fail**

Run: `pnpm --filter @node-media-library/core test`
Expected: FAIL — `InMemoryMediaRepository` no longer implements `MediaRepository` (or the new contract cases fail).

- [ ] **Step 4: Implement in `InMemoryMediaRepository`**

In `packages/core/src/repository/in-memory.ts`, mirror the body style of the existing `markConversionGenerated` (fetch, NOT_FOUND throw, spread-merge, `updatedAt: new Date()`, store, return a copy):

```ts
async setCustomProperty(id: string, key: string, value: unknown): Promise<MediaRecord> {
  const existing = this.records.get(id)
  if (!existing) {
    throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
  }
  const updated: MediaRecord = {
    ...existing,
    customProperties: { ...existing.customProperties, [key]: value },
    updatedAt: new Date(),
  }
  this.records.set(id, updated)
  return { ...updated }
}

async removeCustomProperty(id: string, key: string): Promise<MediaRecord> {
  const existing = this.records.get(id)
  if (!existing) {
    throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
  }
  const customProperties = { ...existing.customProperties }
  delete customProperties[key]
  const updated: MediaRecord = { ...existing, customProperties, updatedAt: new Date() }
  this.records.set(id, updated)
  return { ...updated }
}
```

(Adjust the NOT_FOUND message/construction to byte-match whatever `markConversionGenerated` in that file does today.)

- [ ] **Step 5: Run core tests — contract green**

Run: `pnpm --filter @node-media-library/core test`
Expected: PASS.

- [ ] **Step 6: Implement in the Prisma adapter**

In `packages/prisma/src/adapter.ts`: widen `mergeJsonColumn`'s column union (:147) to `'generatedConversions' | 'responsiveImages' | 'customProperties'`, then add below `mergeResponsiveImages` (:167):

```ts
async setCustomProperty(id: string, key: string, value: unknown): Promise<MediaRecord> {
  return this.mergeJsonColumn(id, 'customProperties', key, value)
}

/**
 * Same read-merge-write shape as mergeJsonColumn but deletes the key.
 * Shares mergeJsonColumn's honesty caveat: inside $transaction when the
 * client provides one, but not lock-safe on read-committed Postgres/MySQL.
 */
async removeCustomProperty(id: string, key: string): Promise<MediaRecord> {
  const run = async (tx: { media: MediaDelegate }) => {
    const row = await tx.media.findUnique({ where: { id } })
    if (!row) {
      throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
    }
    const current = { ...((row.customProperties ?? {}) as Record<string, unknown>) }
    delete current[key]
    return tx.media.update({ where: { id }, data: { customProperties: current } })
  }
  const row = this.client.$transaction ? await this.client.$transaction(run) : await run(this.client)
  return toMediaRecord(row)
}
```

(Match the exact NOT_FOUND message used by `mergeJsonColumn` in that file.)

- [ ] **Step 7: Run prisma tests (contract picks the new cases up automatically)**

Run: `pnpm --filter @node-media-library/prisma test`
Expected: PASS — contract suite runs the 6 new cases against SQLite.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/repository.ts packages/core/src/repository/in-memory.ts packages/core/src/testing/repository-contract.ts packages/prisma/src/adapter.ts
git commit -m "feat(core,prisma): atomic setCustomProperty/removeCustomProperty repository primitives"
```

---

### Task 2: MediaLibrary custom-property surface

**Files:**
- Modify: `packages/core/src/library.ts` (add two methods near `deleteMedia` at :293)
- Test: `packages/core/test/custom-properties.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's repository methods; `private requireMedia(mediaOrId: MediaRecord | string): Promise<MediaRecord>` (`library.ts:216`).
- Produces (docs in Task 7 reference these):
  ```ts
  // on MediaLibrary
  setCustomProperty(mediaOrId: MediaRecord | string, key: string, value: unknown): Promise<MediaRecord>
  removeCustomProperty(mediaOrId: MediaRecord | string, key: string): Promise<MediaRecord>
  ```

- [ ] **Step 1: Write the failing test**

`packages/core/test/custom-properties.test.ts` — build a library the same way neighboring tests do (look at `packages/core/test/handle.test.ts` for the `createMediaLibrary` + `InMemoryMediaRepository` + fs-disk-in-tmp setup and copy its helper):

```ts
it('setCustomProperty merges and returns the fresh record', async () => {
  const media = await library.for('post', '1').add(pngBuffer).toCollection('default')
  const updated = await library.setCustomProperty(media, 'alt', 'a cat')
  expect(updated.customProperties).toEqual({ alt: 'a cat' })
  const again = await library.setCustomProperty(media.id, 'credit', 'Jane')
  expect(again.customProperties).toEqual({ alt: 'a cat', credit: 'Jane' })
})

it('removeCustomProperty deletes one key', async () => {
  const media = await library.for('post', '1').add(pngBuffer)
    .withCustomProperties({ alt: 'a cat', credit: 'Jane' }).toCollection('default')
  const updated = await library.removeCustomProperty(media.id, 'credit')
  expect(updated.customProperties).toEqual({ alt: 'a cat' })
})

it('setCustomProperty on unknown id rejects', async () => {
  await expect(library.setCustomProperty('missing', 'k', 'v')).rejects.toThrow()
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @node-media-library/core test custom-properties`
Expected: FAIL — `setCustomProperty is not a function`.

- [ ] **Step 3: Implement on `MediaLibrary`**

In `packages/core/src/library.ts`, directly above `deleteMedia` (:293):

```ts
/** Set one custom property atomically (sibling keys preserved). */
async setCustomProperty(
  mediaOrId: MediaRecord | string,
  key: string,
  value: unknown,
): Promise<MediaRecord> {
  const media = await this.requireMedia(mediaOrId)
  return this.resolved.repository.setCustomProperty(media.id, key, value)
}

/** Remove one custom property atomically (sibling keys preserved). */
async removeCustomProperty(mediaOrId: MediaRecord | string, key: string): Promise<MediaRecord> {
  const media = await this.requireMedia(mediaOrId)
  return this.resolved.repository.removeCustomProperty(media.id, key)
}
```

- [ ] **Step 4: Run test to verify pass** — `pnpm --filter @node-media-library/core test custom-properties`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/library.ts packages/core/test/custom-properties.test.ts
git commit -m "feat(core): setCustomProperty/removeCustomProperty on MediaLibrary"
```

---

### Task 3: copyMedia / moveMedia

**Files:**
- Modify: `packages/core/src/library.ts` (new methods + `CopyMediaOptions` export)
- Modify: `packages/core/src/events.ts` (two new `MediaEventMap` members)
- Test: `packages/core/test/copy-move.test.ts` (create)

**Interfaces:**
- Consumes: `this.for(modelType, modelId)` (:199, throws `UnknownModelError`), `ModelMediaHandle.add(source: MediaSource): FileAdder`, FileAdder builders `usingName/usingFileName/withCustomProperties/withManipulations/withResponsiveImages/toCollection`, `disk.getStream(key)`, `pathGenerator.path(media)`, `deleteMedia` (:293). `MediaSource` accepts a `Readable` directly (`pipeline/source.ts:7-14`).
- Produces:
  ```ts
  export interface CopyMediaOptions { toCollection?: string }
  // on MediaLibrary
  copyMedia(mediaOrId: MediaRecord | string, toModelType: string, toModelId: string | number, opts?: CopyMediaOptions): Promise<MediaRecord>
  moveMedia(mediaOrId: MediaRecord | string, toModelType: string, toModelId: string | number, opts?: CopyMediaOptions): Promise<MediaRecord>
  // MediaEventMap additions
  'media:copied': { media: MediaRecord; copy: MediaRecord }
  'media:moved': { media: MediaRecord; moved: MediaRecord }
  ```
  Semantics (Spatie parity, document in JSDoc): copy re-runs the full add pipeline on the target — new id/uuid, target-collection validation and rules apply, conversions/responsive REGENERATE (derived files are never byte-copied); the target collection's `disk`/`conversionsDisk` config governs placement (the source record's disks are NOT carried over). `moveMedia` = `copyMedia` + `deleteMedia(source)` — on any copy failure the source is untouched.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/copy-move.test.ts` — reuse the library-builder helper pattern from `packages/core/test/handle.test.ts`; register two model types (`post`, `page`) where `page.default` accepts only `image/*`, plus a `page.single` collection with `.singleFile()`:

```ts
it('copyMedia creates an independent record for the target model', async () => {
  const src = await library.for('post', '1').add(pngBuffer)
    .withCustomProperties({ alt: 'a cat' }).toCollection('default')
  const copy = await library.copyMedia(src.id, 'page', '9')
  expect(copy.id).not.toBe(src.id)
  expect(copy.modelType).toBe('page')
  expect(copy.modelId).toBe('9')
  expect(copy.collectionName).toBe('default')
  expect(copy.fileName).toBe(src.fileName)
  expect(copy.name).toBe(src.name)
  expect(copy.customProperties).toEqual({ alt: 'a cat' })
  // both files exist independently
  const disk = await library.storage.disk(src.disk)
  expect(await disk.exists(library.pathGenerator.path(src))).toBe(true)
  expect(await disk.exists(library.pathGenerator.path(copy))).toBe(true)
})

it('copyMedia emits media:copied', async () => {
  const events: string[] = []
  library.events.on('media:copied', () => events.push('copied'))
  const src = await library.for('post', '1').add(pngBuffer).toCollection('default')
  await library.copyMedia(src, 'page', '9')
  expect(events).toEqual(['copied'])
})

it('copyMedia enforces the target collection rules', async () => {
  // page.single is singleFile: copying twice leaves exactly one record
  const src = await library.for('post', '1').add(pngBuffer).toCollection('default')
  await library.copyMedia(src, 'page', '9', { toCollection: 'single' })
  await library.copyMedia(src, 'page', '9', { toCollection: 'single' })
  expect(await library.for('page', '9').getAll('single')).toHaveLength(1)
})

it('copyMedia to an unregistered model throws', async () => {
  const src = await library.for('post', '1').add(pngBuffer).toCollection('default')
  await expect(library.copyMedia(src, 'nope', '1')).rejects.toThrow()
})

it('moveMedia copies then deletes the source record and files', async () => {
  const src = await library.for('post', '1').add(pngBuffer).toCollection('default')
  const moved = await library.moveMedia(src.id, 'page', '9')
  expect(await library.repository.findById(src.id)).toBeNull()
  const disk = await library.storage.disk(src.disk)
  expect(await disk.exists(library.pathGenerator.path(src))).toBe(false)
  expect(await disk.exists(library.pathGenerator.path(moved))).toBe(true)
})

it('moveMedia emits media:moved (after media:copied)', async () => {
  const order: string[] = []
  library.events.on('media:copied', () => order.push('copied'))
  library.events.on('media:moved', () => order.push('moved'))
  const src = await library.for('post', '1').add(pngBuffer).toCollection('default')
  await library.moveMedia(src, 'page', '9')
  expect(order).toEqual(['copied', 'moved'])
})

it('copyMedia preserves the responsive-images request flag', async () => {
  const src = await library.for('post', '1').add(pngBuffer)
    .withResponsiveImages().toCollection('default')
  const copy = await library.copyMedia(src, 'page', '9')
  expect(copy.responsiveImages['requested'] === true || 'original' in copy.responsiveImages).toBe(true)
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @node-media-library/core test copy-move`
Expected: FAIL — `copyMedia is not a function`.

- [ ] **Step 3: Add the events**

In `packages/core/src/events.ts`, inside `MediaEventMap` (after `'collection:cleared'`):

```ts
'media:copied': { media: MediaRecord; copy: MediaRecord }
'media:moved': { media: MediaRecord; moved: MediaRecord }
```

- [ ] **Step 4: Implement on `MediaLibrary`**

In `packages/core/src/library.ts`, below `clearFor` (:319):

```ts
export interface CopyMediaOptions {
  /** Target collection; defaults to the source record's collection name. */
  toCollection?: string
}
```

(export it next to `RegenerateOptions` re-exports — check how `CleanOptions` is exported from the package index and mirror.)

```ts
/**
 * Copy a media record to another model/collection by re-running the full
 * add pipeline on the target (Spatie semantics): the copy gets a new
 * id/uuid, the target collection's validation, disk config, and rules
 * (singleFile/keepLatest) apply, and conversions/responsive images are
 * regenerated rather than byte-copied. The source is never modified.
 */
async copyMedia(
  mediaOrId: MediaRecord | string,
  toModelType: string,
  toModelId: string | number,
  opts: CopyMediaOptions = {},
): Promise<MediaRecord> {
  const media = await this.requireMedia(mediaOrId)
  const handle = this.for(toModelType, toModelId) // throws UnknownModelError for unregistered models
  const disk = await this.resolved.storage.disk(media.disk)
  const stream = await disk.getStream(this.resolved.pathGenerator.path(media))
  const adder = handle
    .add(stream)
    .usingName(media.name)
    .usingFileName(media.fileName)
    .withCustomProperties({ ...media.customProperties })
    .withManipulations(structuredClone(media.manipulations))
  if (media.responsiveImages['requested'] === true) {
    adder.withResponsiveImages()
  }
  const copy = await adder.toCollection(opts.toCollection ?? media.collectionName)
  this.events.emit('media:copied', { media, copy })
  return copy
}

/**
 * Move = copy + delete-source (Spatie semantics). If the copy fails the
 * source record and files are untouched. Derived files regenerate on the
 * target; they are not carried over.
 */
async moveMedia(
  mediaOrId: MediaRecord | string,
  toModelType: string,
  toModelId: string | number,
  opts: CopyMediaOptions = {},
): Promise<MediaRecord> {
  const media = await this.requireMedia(mediaOrId)
  const moved = await this.copyMedia(media, toModelType, toModelId, opts)
  await this.deleteMedia(media)
  this.events.emit('media:moved', { media, moved })
  return moved
}
```

Note: `modelId` stringification — check what `this.for()` does with `string | number` (handle stores it) and pass through consistently.

- [ ] **Step 5: Run tests** — `pnpm --filter @node-media-library/core test copy-move`
Expected: PASS.

- [ ] **Step 6: Export `CopyMediaOptions` from the package index**

Check `packages/core/src/index.ts` exports `CleanOptions`/`CleanResult`; add `CopyMediaOptions` the same way. Run `pnpm --filter @node-media-library/core typecheck`.

- [ ] **Step 7: Full core suite + commit**

Run: `pnpm --filter @node-media-library/core test` → PASS, then:

```bash
git add packages/core/src/library.ts packages/core/src/events.ts packages/core/src/index.ts packages/core/test/copy-move.test.ts
git commit -m "feat(core): copyMedia/moveMedia with media:copied/media:moved events"
```

---

### Task 4: ImageOptimizer seam in the conversion engine

**Files:**
- Create: `packages/core/src/conversions/optimizer.ts`
- Modify: `packages/core/src/config.ts` (`optimizers?` key + resolved field)
- Modify: `packages/core/src/conversions/engine.ts` (deps member + apply before both `put`s)
- Modify: `packages/core/src/library.ts` (pass `optimizers` into `new ConversionEngine({...})` at :44-55)
- Modify: `packages/core/src/index.ts` (export the new types)
- Test: `packages/core/test/optimizer.test.ts` (create)

**Interfaces:**
- Consumes: engine write sites — conversion output at `engine.ts:269-274` (`generator.toImage` → `conversionKey` → `conversionsDisk.put`), responsive variant at `engine.ts:143-148` (`renderVariant` → `disk.put`). `ConversionEngineDeps` (:31). `resolveConfig` defaults (config.ts:73).
- Produces (Task 5 implements this interface; Task 7 documents it):
  ```ts
  export interface OptimizeContext {
    /** Effective output format; null means the original file's own format. */
    format: 'jpeg' | 'png' | 'webp' | 'avif' | null
    fileName: string
    media: MediaRecord
    kind: 'conversion' | 'responsive'
  }
  export interface ImageOptimizer {
    name: string
    /** Return optimized bytes, or null to pass (unsupported format / binary missing). */
    optimize(buffer: Buffer, ctx: OptimizeContext): Promise<Buffer | null>
  }
  ```
  Config: `optimizers?: ImageOptimizer[]` (default `[]`). Engine rules: optimizers run in order, each fed the previous output; a result is accepted only if non-empty AND strictly smaller; a throwing optimizer logs `console.warn` and is skipped (a failed optimizer must NEVER fail the conversion); responsive variants derive from the UNOPTIMIZED conversion output (optimize only what is written).

- [ ] **Step 1: Write the failing tests**

`packages/core/test/optimizer.test.ts` — library builder with an fs disk in a tmp dir (copy the conversions-test setup from `packages/core/test/engine.test.ts` or the nearest conversion integration test), a `thumb` conversion on `post.default`, and fake optimizers:

```ts
function shrinker(name: string, calls: OptimizeContext[]): ImageOptimizer {
  return {
    name,
    async optimize(buffer, ctx) {
      calls.push(ctx)
      return buffer.subarray(0, buffer.length - 1) // strictly smaller, deterministic
    },
  }
}

it('optimizer output is what lands on disk for conversions', async () => {
  const calls: OptimizeContext[] = []
  const library = makeLibrary({ optimizers: [shrinker('s', calls)] })
  const media = await library.for('post', '1').add(pngBuffer).toCollection('default')
  // sync queue driver: conversions already ran
  const record = (await library.repository.findById(media.id))!
  expect(record.generatedConversions['thumb']).toBe(true)
  expect(calls.some((c) => c.kind === 'conversion' && c.fileName.includes('thumb'))).toBe(true)
  // stored bytes are exactly one byte shorter than what a no-optimizer library writes
  const plain = makeLibrary({ optimizers: [] })
  const plainMedia = await plain.for('post', '1').add(pngBuffer).toCollection('default')
  const optimizedBytes = await readConversionBytes(library, record, 'thumb')
  const plainBytes = await readConversionBytes(plain, plainMedia, 'thumb')
  expect(optimizedBytes.length).toBe(plainBytes.length - 1)
})

it('a larger result is rejected', async () => {
  const grower: ImageOptimizer = {
    name: 'g',
    async optimize(buffer) { return Buffer.concat([buffer, Buffer.from([0])]) },
  }
  // bytes on disk match the plain library exactly
})

it('a throwing optimizer warns and never fails the conversion', async () => {
  const boom: ImageOptimizer = { name: 'boom', async optimize() { throw new Error('boom') } }
  // add succeeds, generatedConversions.thumb === true, console.warn spied and called
})

it('null return passes through unchanged', async () => { /* bytes match plain library */ })

it('responsive variants are optimized too (kind: "responsive")', async () => {
  // thumb conversion with .withResponsiveImages() on a responsive-enabled def;
  // assert calls include kind === 'responsive'
})
```

Write `readConversionBytes` as a local helper using `library.storage.disk(...)` + `conversionFileName` (import from `../src/conversions/naming.js` the way other tests do — check first).

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @node-media-library/core test optimizer`
Expected: FAIL — `optimizers` unknown config key / no optimization observed.

- [ ] **Step 3: Create `packages/core/src/conversions/optimizer.ts`** with the two interfaces exactly as in the Interfaces block above.

- [ ] **Step 4: Wire config**

`packages/core/src/config.ts`: add `optimizers?: ImageOptimizer[]` to `MediaLibraryConfig` (:19), `readonly optimizers: readonly ImageOptimizer[]` to `ResolvedConfig` (:51), default `config.optimizers ?? []` in `resolveConfig` (:73), frozen like `imageGenerators`.

- [ ] **Step 5: Wire engine**

`packages/core/src/conversions/engine.ts`:
- Add `optimizers: readonly ImageOptimizer[]` to `ConversionEngineDeps` (:31).
- Add a private helper:

```ts
private async optimizeBytes(buffer: Buffer, ctx: OptimizeContext): Promise<Buffer> {
  let out = buffer
  for (const optimizer of this.deps.optimizers) {
    try {
      const result = await optimizer.optimize(out, ctx)
      if (result && result.length > 0 && result.length < out.length) {
        out = result
      }
    } catch (error) {
      console.warn(
        `[media-library] optimizer "${optimizer.name}" failed for ${ctx.fileName}; using unoptimized bytes`,
        error,
      )
    }
  }
  return out
}
```

- Conversion write (:269-274): keep `output` (unoptimized) for `generateResponsive`, write optimized bytes:

```ts
const output = await generator.toImage(originalBuffer, effectiveDef)
const key = conversionKey(media, this.deps.pathGenerator, effectiveDef, name)
const optimized = await this.optimizeBytes(output, {
  format: effectiveDef.format,
  fileName: key,
  media,
  kind: 'conversion',
})
await conversionsDisk.put(key, optimized, writeOptions)
if (effectiveDef.responsiveImages) {
  await this.generateResponsive(media, name, output, effectiveDef.format, effectiveDef.quality)
}
```

- Responsive write (:143-148): optimize `variant.buffer` before `disk.put` with `kind: 'responsive'` and the variant `fileName`. Do NOT optimize the LQIP placeholder (it's a data URI, never written to disk) or the original file.

- `packages/core/src/library.ts` (:44-55): add `optimizers: this.resolved.optimizers` to the `new ConversionEngine({...})` deps. Check whether other engine constructions exist in tests that build `ConversionEngine` directly — if so they'll fail to compile; add `optimizers: []` there.

- [ ] **Step 6: Run tests** — `pnpm --filter @node-media-library/core test optimizer` → PASS, then the full core suite → PASS.

- [ ] **Step 7: Export from index**

Add `ImageOptimizer`, `OptimizeContext` to `packages/core/src/index.ts` next to the `ImageGenerator` export. `pnpm --filter @node-media-library/core typecheck`.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/conversions/optimizer.ts packages/core/src/conversions/engine.ts packages/core/src/config.ts packages/core/src/library.ts packages/core/src/index.ts packages/core/test/optimizer.test.ts
git commit -m "feat(core): ImageOptimizer seam applied before conversion/responsive writes"
```

---

### Task 5: @node-media-library/optimizers package

**Files:**
- Create: `packages/optimizers/package.json`, `tsconfig.json`, `tsconfig.build.json`, `LICENSE`, `README.md` — ALL copied from `packages/pdf/` equivalents, with names swapped (`@node-media-library/optimizers`, description "Binary image optimizers (jpegoptim, pngquant) for node-media-library") and NO `sharp` devDependency; `dependencies: { "@node-media-library/core": "workspace:*" }`, `prepack` guard, `publishConfig.exports`, `files`, `engines`, `prepublishOnly` all identical in shape to pdf's.
- Create: `packages/optimizers/src/args.ts`, `src/run.ts`, `src/optimizers.ts`, `src/index.ts`
- Test: `packages/optimizers/test/args.test.ts`, `test/optimizers.test.ts`
- Modify: `.github/workflows/ci.yml` (add `jpegoptim pngquant` to the existing apt-get install line that already installs `poppler-utils ffmpeg`)

**Interfaces:**
- Consumes: `ImageOptimizer`, `OptimizeContext` from `@node-media-library/core` (Task 4). The execFile+temp-file pattern from `packages/pdf/src/run.ts` and availability checks from `packages/pdf/src/generator.ts` (`pdftoppmAvailable`) — read both before writing.
- Produces:
  ```ts
  export interface JpegoptimOptions { jpegoptimPath?: string /* default 'jpegoptim' */; max?: number /* quality cap 0-100, default 85 */ }
  export interface PngquantOptions { pngquantPath?: string /* default 'pngquant' */; quality?: string /* e.g. '65-90', default undefined = pngquant default */ }
  export function jpegoptimOptimizer(opts?: JpegoptimOptions): ImageOptimizer  // handles ctx.format === 'jpeg' only, else returns null
  export function pngquantOptimizer(opts?: PngquantOptions): ImageOptimizer    // handles ctx.format === 'png' only, else returns null
  export function jpegoptimAvailable(path?: string): Promise<boolean>
  export function pngquantAvailable(path?: string): Promise<boolean>
  ```
  Binary contracts: jpegoptim optimizes IN PLACE (`jpegoptim --strip-all --all-progressive -m<max> <file>` then read the file back); pngquant writes to a separate output (`pngquant --force --output <out> [--quality <range>] <in>`, read `<out>`). Both via `execFile` with args arrays built by pure functions in `args.ts`; temp dirs via `mkdtemp` cleaned in `finally`; if the binary itself is missing at optimize() time (ENOENT), return `null` (pass), don't throw.

- [ ] **Step 1: Scaffold the package** (copy pdf's files, swap names, add to nothing else — `pnpm-workspace.yaml` already globs `packages/*`). Run `pnpm install` to link the workspace dep.

- [ ] **Step 2: Write pure-arg tests (failing)**

`packages/optimizers/test/args.test.ts`:

```ts
import { buildJpegoptimArgs, buildPngquantArgs } from '../src/args.js'

it('jpegoptim args: strip, progressive, quality cap, target file last', () => {
  expect(buildJpegoptimArgs('/t/in.jpg', { max: 80 })).toEqual([
    '--strip-all', '--all-progressive', '-m80', '/t/in.jpg',
  ])
  expect(buildJpegoptimArgs('/t/in.jpg', {})).toEqual([
    '--strip-all', '--all-progressive', '-m85', '/t/in.jpg',
  ])
})

it('pngquant args: force, optional quality, output before input', () => {
  expect(buildPngquantArgs('/t/in.png', '/t/out.png', {})).toEqual([
    '--force', '--output', '/t/out.png', '/t/in.png',
  ])
  expect(buildPngquantArgs('/t/in.png', '/t/out.png', { quality: '65-90' })).toEqual([
    '--force', '--quality', '65-90', '--output', '/t/out.png', '/t/in.png',
  ])
})
```

- [ ] **Step 3: Implement `src/args.ts`** (pure functions matching the tests exactly), run args tests → PASS.

- [ ] **Step 4: Implement `src/run.ts` + `src/optimizers.ts`**

`run.ts`: `runBinary(path: string, args: string[]): Promise<void>` wrapping `execFile` (promisified, no shell) and `binaryAvailable(path: string, probeArgs: string[]): Promise<boolean>` (spawn with `--version`, resolve false on ENOENT/non-zero) — mirror `packages/pdf/src/run.ts` and its availability helper as closely as the binaries allow.

`optimizers.ts` sketch for jpegoptim (pngquant analogous with in/out files):

```ts
export function jpegoptimOptimizer(opts: JpegoptimOptions = {}): ImageOptimizer {
  const bin = opts.jpegoptimPath ?? 'jpegoptim'
  return {
    name: 'jpegoptim',
    async optimize(buffer, ctx) {
      if (ctx.format !== 'jpeg') return null
      const dir = await mkdtemp(join(tmpdir(), 'nml-jpegoptim-'))
      try {
        const file = join(dir, 'in.jpg')
        await writeFile(file, buffer)
        try {
          await runBinary(bin, buildJpegoptimArgs(file, opts))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        }
        return await readFile(file)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}
```

- [ ] **Step 5: Gated behavior tests**

`packages/optimizers/test/optimizers.test.ts` — mirror the pdf package's gating (`const available = await jpegoptimAvailable(); describe.runIf(available)(...)`). Inside the gated suite: use committed tiny fixture files `test/fixtures/sample.jpg` and `test/fixtures/sample.png` (create them with a one-off `sharp` script run from `packages/core`'s node_modules during development; the fixtures themselves are what's committed — the package must NOT depend on sharp). Assert: `output === null || output.length <= input.length`, and when non-null the bytes still start with the right magic (`ffd8` for JPEG, `\x89PNG` for PNG). Ungated tests (always run): a `format: 'webp'` context returns null; a missing binary path (`jpegoptimPath: '/nonexistent/jpegoptim'`) returns null.

- [ ] **Step 6: Run** — `pnpm --filter @node-media-library/optimizers test` (gated suites skip on this machine — expected), `pnpm -r typecheck`, `pnpm -r build`.

- [ ] **Step 7: CI** — in `.github/workflows/ci.yml`, extend the existing `apt-get install -y poppler-utils ffmpeg` line with ` jpegoptim pngquant` (the CI matrix is where these gated suites first actually run, same as pdf/video).

- [ ] **Step 8: Commit**

```bash
git add packages/optimizers .github/workflows/ci.yml pnpm-lock.yaml
git commit -m "feat(optimizers): @node-media-library/optimizers with jpegoptim + pngquant binary optimizers"
```

---

### Task 6: GCS disk driver

**Files:**
- Modify: `packages/core/src/storage/resolve.ts` (union member, `disk()` branch, `synthesizeDefaultDisk` env branch)
- Modify: `packages/core/src/storage/url-generator.ts` (only if inspection shows the non-fs path doesn't already delegate to `disk.getUrl`/`getSignedUrl` — read `publicUrlFor`/`signedUrlFor` at :87-131 first; the S3 branch is the template for any baseUrl handling)
- Modify: `packages/core/package.json` (`peerDependencies`: `"@google-cloud/storage": "^7.10.2"` with `peerDependenciesMeta` optional — mirror how flydrive itself declares it; `devDependencies`: same version for tests)
- Test: `packages/core/test/gcs-disk.test.ts` (create)

**Interfaces:**
- Consumes: flydrive's in-package driver `import { GCSDriver } from 'flydrive/drivers/gcs'` — `GCSDriverOptions` requires `bucket: string` and `visibility: ObjectVisibility` (REQUIRED, unlike fs/s3), optional `usingUniformAcl?: boolean` (defaults true — when true, per-object visibility is a no-op) plus `@google-cloud/storage` `StorageOptions` (`projectId`, `keyFilename`, `credentials`).
- Produces:
  ```ts
  // DiskConfig union gains:
  | {
      driver: 'gcs'
      bucket: string
      visibility?: 'public' | 'private'      // default 'private'
      usingUniformAcl?: boolean
      projectId?: string
      keyFilename?: string
      credentials?: Record<string, unknown>
      baseUrl?: string
    }
  ```
  Env synthesis: `MEDIA_GCS_BUCKET` set (and `MEDIA_S3_BUCKET` not set) → `{ driver: 'gcs', bucket, visibility: 'private' }`; S3 keeps precedence.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/gcs-disk.test.ts`:

```ts
import { resolveStorage } from '../src/storage/resolve.js'

it('resolves a gcs disk to a flydrive Disk backed by GCSDriver', async () => {
  const storage = resolveStorage({ disks: { media: { driver: 'gcs', bucket: 'test-bucket' } }, default: 'media' })
  const disk = await storage.disk('media')
  expect(disk).toBeDefined()
  // driver identity: getUrl is the observable contract
  const url = await disk.getUrl('some/key.png')
  expect(url).toContain('test-bucket')
  expect(url).toContain('some/key.png')
})

it('MEDIA_GCS_BUCKET synthesizes a private gcs default disk', () => {
  const storage = resolveStorage(undefined, { MEDIA_GCS_BUCKET: 'env-bucket' })
  expect(storage.diskConfig()).toMatchObject({ driver: 'gcs', bucket: 'env-bucket', visibility: 'private' })
})

it('MEDIA_S3_BUCKET wins over MEDIA_GCS_BUCKET', () => {
  const storage = resolveStorage(undefined, { MEDIA_S3_BUCKET: 's3b', MEDIA_GCS_BUCKET: 'gb' })
  expect(storage.diskConfig()).toMatchObject({ driver: 's3', bucket: 's3b' })
})
```

(If `GCSDriver.getUrl` turns out to require live credentials, downgrade the first test to asserting `storage.disk('media')` resolves without throwing and `diskConfig('media').driver === 'gcs'`, and note why in a comment.)

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @node-media-library/core test gcs-disk`
Expected: FAIL — TS narrows `driver: 'gcs'` as invalid / unknown driver error.

- [ ] **Step 3: Add the devDependency + optional peer**

`packages/core/package.json`: `devDependencies` + optional `peerDependencies` entry for `@google-cloud/storage ^7.10.2` (copy the `peerDependenciesMeta` shape from how `packages/prisma/package.json` marks its optional peer). `pnpm install`.

- [ ] **Step 4: Implement**

`resolve.ts`: extend the `DiskConfig` union as specified; in `disk()`, add a branch mirroring the existing dynamic-import style (fs at :94, s3 at :102):

```ts
if (cfg.driver === 'gcs') {
  const { GCSDriver } = await import('flydrive/drivers/gcs')
  const { bucket, visibility = 'private', usingUniformAcl, projectId, keyFilename, credentials } = cfg
  driver = new GCSDriver({
    bucket,
    visibility,
    ...(usingUniformAcl !== undefined ? { usingUniformAcl } : {}),
    ...(projectId ? { projectId } : {}),
    ...(keyFilename ? { keyFilename } : {}),
    ...(credentials ? { credentials } : {}),
  })
}
```

(Adapt to the exact local variable/`new Disk(driver)` shape the fs/s3 branches use.) In `synthesizeDefaultDisk` (:44): after the `MEDIA_S3_BUCKET` branch, add `if (env.MEDIA_GCS_BUCKET) return { driver: 'gcs', bucket: env.MEDIA_GCS_BUCKET, visibility: 'private' }`. Read `url-generator.ts:87-131`; if `baseUrl` is honored for s3 configs, honor it identically for gcs (same property access — the union member has it); if the generic path just calls `disk.getUrl`, no change is needed.

- [ ] **Step 5: Run tests** — `pnpm --filter @node-media-library/core test gcs-disk` → PASS; full core suite → PASS; `pnpm -r typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/storage/resolve.ts packages/core/src/storage/url-generator.ts packages/core/package.json packages/core/test/gcs-disk.test.ts pnpm-lock.yaml
git commit -m "feat(core): native GCS disk driver via flydrive/drivers/gcs"
```

---

### Task 7: clean() skip counters, docs, spec, exports audit

**Files:**
- Modify: `packages/core/src/maintenance/clean.ts` (`CleanResult` two new fields)
- Modify: `packages/core/src/library.ts` (increment sites :557 and :570)
- Modify: `packages/core/src/cli/run.ts` (clean output lines :160-167)
- Modify: `packages/core/test/clean.test.ts`, `packages/core/test/cli.test.ts` (assert new counters/lines)
- Modify: `docs/superpowers/specs/2026-07-26-node-media-library-design.md` (§7 post-v1 paragraph, §2 disks, optimizer out-of-scope note at :203)
- Modify: `packages/core/README.md`, root `README.md` (roadmap prune + new feature docs), flesh out `packages/optimizers/README.md` if Task 5 left it a stub
- Modify: `packages/core/src/index.ts` (final exports audit)

**Interfaces:**
- Consumes: everything Tasks 1–6 shipped.
- Produces:
  ```ts
  export interface CleanResult {
    orphanedMediaDeleted: number
    staleFilesDeleted: number
    staleEntriesRemoved: number
    /** Total records skipped for safety (sum of the two reasons below). */
    skippedUnregistered: number
    /** Skipped: modelType/collection not present in this config. */
    skippedUnregisteredTargets: number
    /** Skipped: no registered image generator supports the record's mime. */
    skippedWithoutGenerator: number
    dryRun: boolean
  }
  ```

- [ ] **Step 1: Extend `clean.test.ts` (failing)** — the existing tests that produce skips must now also assert the per-reason fields; add one test where BOTH reasons occur and `skippedUnregistered === skippedUnregisteredTargets + skippedWithoutGenerator`.

- [ ] **Step 2: Implement** — add the two fields to `CleanResult` (`clean.ts:12`), initialize them in `library.ts` `clean()` alongside the existing counters, increment `skippedUnregisteredTargets` at the :557 site and `skippedWithoutGenerator` at the :570 site (keep incrementing the existing total at both). In `cli/run.ts` clean output (:160-167) add two indented breakdown lines under the existing skipped line, e.g. `  - unregistered model/collection: N` / `  - no generator for mime: N`. Update `cli.test.ts` expectations.

- [ ] **Step 3: Run** — `pnpm --filter @node-media-library/core test` → PASS.

- [ ] **Step 4: Spec updates** — in `docs/superpowers/specs/2026-07-26-node-media-library-design.md`:
  - §7: replace the "Post-v1 (not in current release)" paragraph for `move`/`copy`/`setCustomProperty` with the shipped API (`copyMedia`/`moveMedia` on MediaLibrary with Spatie copy-then-delete semantics and regenerate-not-copy for derived files; `setCustomProperty`/`removeCustomProperty` atomic single-key).
  - §2 (storage/disks): add the `gcs` driver config shape and `MEDIA_GCS_BUCKET` env synthesis (S3 takes precedence).
  - Out-of-scope list (:203): remove "image optimizer binary chain" and instead document the `optimizers` config seam + `@node-media-library/optimizers`.

- [ ] **Step 5: README updates**
  - `packages/core/README.md`: document `setCustomProperty`/`removeCustomProperty`, `copyMedia`/`moveMedia` (explicitly: derived files regenerate; move is copy+delete; target collection's disks/rules govern), the `optimizers` config option with a `jpegoptimOptimizer()` example importing from `@node-media-library/optimizers`, the `gcs` disk example; prune the "Not yet implemented" roadmap of everything this plan shipped (keep what remains: large-video memory/N+1 spawns, Prisma merge atomicity on read-committed SQL).
  - Root `README.md`: add `@node-media-library/optimizers` to the packages table; prune its roadmap identically.
  - `packages/optimizers/README.md`: install (`jpegoptim`/`pngquant` are SYSTEM binaries — apt/brew lines), usage snippet wiring into `createMediaLibrary({ optimizers: [...] })`, note on the smaller-only acceptance rule and null-pass behavior.

- [ ] **Step 6: Exports audit** — confirm `packages/core/src/index.ts` exports: `ImageOptimizer`, `OptimizeContext`, `CopyMediaOptions`, and that the widened `CleanResult` flows out; confirm `packages/optimizers/src/index.ts` exports the four functions + two option types. Run `pnpm -r typecheck && pnpm -r build && pnpm -r test`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/maintenance/clean.ts packages/core/src/library.ts packages/core/src/cli/run.ts packages/core/test/clean.test.ts packages/core/test/cli.test.ts packages/core/src/index.ts packages/core/README.md README.md packages/optimizers/README.md docs/superpowers/specs/2026-07-26-node-media-library-design.md
git commit -m "feat(core): per-reason clean() skip counters; docs for parity features"
```
