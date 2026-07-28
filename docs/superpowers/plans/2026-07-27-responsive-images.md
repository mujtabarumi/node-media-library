# Responsive Images Implementation Plan (Plan 4 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate width-optimized responsive image variants (srcset data + LQIP placeholders) for originals and conversions, tracked in the `responsiveImages` JSON column, per spec §9.

**Architecture:** A pure `FileSizeOptimizedWidthCalculator` picks target widths from the source's file size and dimensions. The existing `ConversionEngine` grows a responsive step: after a conversion whose definition has `responsiveImages: true` completes, and for the pseudo-conversion name `original` (opt-in per collection or per-add), it renders scaled variants with sharp into `{mediaId}/responsive/` and records `{ files: [{fileName,width,height}], placeholder? }` per conversion name via a **new atomic repository merge method** (the Plan-3 review prerequisite). Read surface: `MediaLibrary.srcset() / responsiveUrls() / placeholder()` build URLs live from stored file names.

**Tech Stack:** TypeScript ESM (`.js` import suffixes), sharp ^0.35 (already a core dep), flydrive ^1.3.0, vitest, pnpm workspaces.

## Global Constraints

- Node floor: `>=20`; flydrive pinned `^1.3.0` (2.x needs Node >=24). Do not bump either.
- `MediaEventMap` in `packages/core/src/events.ts` MUST stay an `interface` (declaration-merging pattern); add new events directly to it.
- All core imports use explicit `.js` suffixes; no new runtime dependencies in this plan.
- `@node-media-library/prisma` src/ must not import `@prisma/client` — the client stays duck-typed via `PrismaLikeClient`.
- Run tests per package: `pnpm --filter @node-media-library/core test`, `pnpm --filter @node-media-library/prisma test` (prisma tests run `db push` in global-setup; never pass `--force-reset`).
- Queue job payload stays exactly `{ mediaId, conversionNames }` — the pseudo-conversion name `'original'` rides inside `conversionNames` as the "regenerate original responsive variants" sentinel.
- Commit after every task; conventional commit messages.

## Spec deviation (decided at planning time, apply in Task 5)

Spec §9 says the `responsiveImages` JSON stores `{ [conversion]: { urls: string[], placeholder? } }`. Storing absolute URLs at generation time is wrong for this library: disks are **private by default** (public `url()` may legitimately throw on fs disks without `baseUrl`), signed URLs expire, and stored URLs break on disk migration. We store **file names + dimensions** instead and build URLs at read time:

```json
{ "thumb": { "files": [{ "fileName": "photo___thumb_800_600.jpeg", "width": 800, "height": 600 }], "placeholder": "data:image/svg+xml;base64,..." } }
```

Task 5 updates the spec's §9 line to match. `srcset()` returns only real variants (`url 800w, url 673w, ...`); the placeholder is exposed separately via `placeholder()` — a `<img>` `srcset` attribute cannot carry an LQIP data URI meaningfully.

## File Structure

- Create: `packages/core/src/responsive/width-calculator.ts` — `WidthCalculator` interface + `FileSizeOptimizedWidthCalculator`
- Create: `packages/core/src/responsive/naming.ts` — `responsiveFileName()`
- Create: `packages/core/src/responsive/types.ts` — `ResponsiveVariant`, `ResponsiveImagesEntry`
- Create: `packages/core/src/responsive/generator.ts` — sharp resize + LQIP placeholder helpers
- Modify: `packages/core/src/repository.ts`, `src/repository/in-memory.ts`, `src/testing/repository-contract.ts` — atomic merge methods
- Modify: `packages/prisma/src/client.ts`, `src/adapter.ts` — implement merge methods (optional `$transaction`)
- Modify: `packages/core/src/conversions/engine.ts` — responsive generation step + `'original'` sentinel
- Modify: `packages/core/src/events.ts` — `responsive:generated` event
- Modify: `packages/core/src/pipeline/file-adder.ts` — enqueue `'original'` when responsive wanted
- Modify: `packages/core/src/config.ts`, `src/library.ts` — config knobs, read surface, regenerate `withResponsive`
- Modify: `packages/core/src/storage/url-generator.ts` — `responsiveUrl` on the interface (optional member)
- Modify: `packages/core/src/index.ts`, READMEs, spec §9

---

### Task 1: Atomic repository merge methods (Plan-3 review prerequisite)

**Files:**
- Modify: `packages/core/src/repository.ts`
- Modify: `packages/core/src/repository/in-memory.ts`
- Modify: `packages/core/src/testing/repository-contract.ts`
- Modify: `packages/core/src/conversions/engine.ts` (switch `perform()` to the new method)
- Modify: `packages/prisma/src/client.ts`, `packages/prisma/src/adapter.ts`
- Test: contract suite (runs in both `packages/core/test/in-memory-repository.test.ts` and the prisma contract test), `packages/core/test/conversions.test.ts` (existing tests must stay green)

**Interfaces:**
- Consumes: existing `MediaRepository`, `toMediaRecord`, `MediaDelegate`.
- Produces (later tasks rely on these exact signatures):
  - `MediaRepository.markConversionGenerated(id: string, name: string, generated: boolean): Promise<MediaRecord>` — atomically merges `{ [name]: generated }` into `generatedConversions` without clobbering other keys; throws `MediaLibraryError` code `NOT_FOUND` for unknown ids; bumps `updatedAt`.
  - `MediaRepository.mergeResponsiveImages(id: string, conversion: string, entry: JsonObject): Promise<MediaRecord>` — atomically sets `responsiveImages[conversion] = entry`, preserving other conversion keys; same NOT_FOUND/updatedAt semantics.

- [ ] **Step 1: Add the two methods to the `MediaRepository` interface** in `packages/core/src/repository.ts` (import `JsonObject` from `./types.js`):

```ts
  /**
   * Atomically merges `{ [name]: generated }` into the record's
   * `generatedConversions` map. Unlike a read→`update()` round-trip in the
   * caller, the read-merge-write happens inside the repository, where the
   * adapter can serialize it (transaction, single-threaded map, ...), so two
   * concurrent calls for different names must both persist.
   */
  markConversionGenerated(id: string, name: string, generated: boolean): Promise<MediaRecord>
  /** Same contract for `responsiveImages[conversion] = entry`. */
  mergeResponsiveImages(id: string, conversion: string, entry: JsonObject): Promise<MediaRecord>
```

- [ ] **Step 2: Write failing contract tests** in `packages/core/src/testing/repository-contract.ts` (inside the existing `describe`):

```ts
    it('markConversionGenerated merges without clobbering other keys', async () => {
      const created = await repo.create(makeRecord({ generatedConversions: { thumb: true } }))
      await sleep(2)
      const updated = await repo.markConversionGenerated(created.id, 'preview', true)
      expect(updated.generatedConversions).toEqual({ thumb: true, preview: true })
      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
      const found = await repo.findById(created.id)
      expect(found?.generatedConversions).toEqual({ thumb: true, preview: true })
    })

    it('markConversionGenerated rejects unknown id with MediaLibraryError', async () => {
      await expect(repo.markConversionGenerated('nope', 'thumb', true)).rejects.toThrow(MediaLibraryError)
    })

    it('concurrent markConversionGenerated calls for different names both persist', async () => {
      const created = await repo.create(makeRecord())
      await Promise.all([
        repo.markConversionGenerated(created.id, 'a', true),
        repo.markConversionGenerated(created.id, 'b', true),
      ])
      const found = await repo.findById(created.id)
      expect(found?.generatedConversions).toEqual({ a: true, b: true })
    })

    it('mergeResponsiveImages sets one conversion key and preserves the rest', async () => {
      const created = await repo.create(
        makeRecord({ responsiveImages: { original: { files: [] } } }),
      )
      const updated = await repo.mergeResponsiveImages(created.id, 'thumb', { files: [{ fileName: 'x', width: 1, height: 1 }] })
      expect(updated.responsiveImages).toEqual({
        original: { files: [] },
        thumb: { files: [{ fileName: 'x', width: 1, height: 1 }] },
      })
      await expect(repo.mergeResponsiveImages('nope', 'thumb', {})).rejects.toThrow(MediaLibraryError)
    })
```

- [ ] **Step 3: Run the core contract test to verify the new tests fail** (methods missing): `pnpm --filter @node-media-library/core test -- in-memory-repository` — expect failures/type errors.

- [ ] **Step 4: Implement in `InMemoryMediaRepository`** (`packages/core/src/repository/in-memory.ts`):

```ts
  async markConversionGenerated(id: string, name: string, generated: boolean): Promise<MediaRecord> {
    const existing = this.records.get(id)
    if (!existing) {
      throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
    }
    const updated: MediaRecord = {
      ...existing,
      generatedConversions: { ...existing.generatedConversions, [name]: generated },
      updatedAt: new Date(),
    }
    this.records.set(id, updated)
    return updated
  }

  async mergeResponsiveImages(id: string, conversion: string, entry: JsonObject): Promise<MediaRecord> {
    const existing = this.records.get(id)
    if (!existing) {
      throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
    }
    const updated: MediaRecord = {
      ...existing,
      responsiveImages: { ...existing.responsiveImages, [conversion]: entry },
      updatedAt: new Date(),
    }
    this.records.set(id, updated)
    return updated
  }
```

(`JsonObject` is already exported from `../types.js`; add it to the existing import.)

- [ ] **Step 5: Run core tests — contract green**: `pnpm --filter @node-media-library/core test -- in-memory-repository` → PASS.

- [ ] **Step 6: Switch `ConversionEngine.perform()` to the atomic method.** In `packages/core/src/conversions/engine.ts`, replace the re-read + `update()` block (the `fresh` read and `repository.update(...)` call, including the long race-window comment) with:

```ts
        // Atomic merge inside the repository (Plan 4): no read→write gap in
        // this layer, so concurrent perform() calls can no longer clobber
        // each other's generatedConversions marks.
        const updated = await this.deps.repository.markConversionGenerated(mediaId, name, true)
```

The earlier per-iteration `before` re-read (used for event snapshots) stays.

- [ ] **Step 7: Run all core tests**: `pnpm --filter @node-media-library/core test` → all PASS (conversions tests exercised the old path; they must stay green).

- [ ] **Step 8: Prisma — add optional `$transaction` to the duck type.** In `packages/prisma/src/client.ts`:

```ts
export interface PrismaLikeClient {
  media: MediaDelegate
  /**
   * Prisma's interactive-transaction API. Optional: when present (any real
   * PrismaClient), the JSON merge methods run their read-merge-write inside
   * it; when absent, they fall back to a plain read-merge-write (documented
   * residual race for exotic clients that lack transactions).
   */
  $transaction?<T>(fn: (tx: { media: MediaDelegate }) => Promise<T>): Promise<T>
}
```

- [ ] **Step 9: Implement both methods in `PrismaMediaRepository`** (`packages/prisma/src/adapter.ts`):

```ts
  private async mergeJsonColumn(
    id: string,
    column: 'generatedConversions' | 'responsiveImages',
    key: string,
    value: unknown,
  ): Promise<MediaRecord> {
    const run = async (tx: { media: MediaDelegate }) => {
      const row = await tx.media.findUnique({ where: { id } })
      if (!row) {
        throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
      }
      const current = (row[column] ?? {}) as Record<string, unknown>
      return tx.media.update({ where: { id }, data: { [column]: { ...current, [key]: value } } })
    }
    const row = this.client.$transaction ? await this.client.$transaction(run) : await run(this.client)
    return toMediaRecord(row)
  }

  async markConversionGenerated(id: string, name: string, generated: boolean): Promise<MediaRecord> {
    return this.mergeJsonColumn(id, 'generatedConversions', name, generated)
  }

  async mergeResponsiveImages(id: string, conversion: string, entry: JsonObject): Promise<MediaRecord> {
    return this.mergeJsonColumn(id, 'responsiveImages', conversion, entry)
  }
```

Add `JsonObject` to the type imports from `@node-media-library/core` and `MediaDelegate` to the imports from `./client.js`.

- [ ] **Step 10: Run prisma tests (contract now includes the new cases)**: `pnpm --filter @node-media-library/prisma test` → PASS. Also the repo's typecheck (`pnpm -r exec tsc --noEmit` or existing script) → clean.

- [ ] **Step 11: Commit**:

```bash
git add -A
git commit -m "feat(core,prisma): atomic JSON merge repository methods for conversion/responsive tracking"
```

---

### Task 2: Width calculator, responsive naming, and types

**Files:**
- Create: `packages/core/src/responsive/width-calculator.ts`
- Create: `packages/core/src/responsive/naming.ts`
- Create: `packages/core/src/responsive/types.ts`
- Test: `packages/core/test/responsive-widths.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `interface WidthCalculator { calculateWidths(fileSizeBytes: number, width: number, height: number): number[] }`
  - `class FileSizeOptimizedWidthCalculator implements WidthCalculator`
  - `responsiveFileName(originalFileName: string, conversionName: string, width: number, height: number, format: string | null): string` → `'photo.jpg','thumb',800,600,null` → `photo___thumb_800_600.jpg`; with `format:'webp'` → `photo___thumb_800_600.webp`; extensionless input keeps no extension.
  - `interface ResponsiveVariant { fileName: string; width: number; height: number }`
  - `interface ResponsiveImagesEntry { files: ResponsiveVariant[]; placeholder?: string }`

- [ ] **Step 1: Write failing tests** in `packages/core/test/responsive-widths.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FileSizeOptimizedWidthCalculator } from '../src/responsive/width-calculator.js'
import { responsiveFileName } from '../src/responsive/naming.js'

describe('FileSizeOptimizedWidthCalculator', () => {
  const calc = new FileSizeOptimizedWidthCalculator()

  it('starts at the original width and shrinks by ~sqrt(0.7) per step', () => {
    const widths = calc.calculateWidths(1_000_000, 2400, 1800)
    expect(widths[0]).toBe(2400)
    expect(widths.length).toBeGreaterThan(3)
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThan(widths[i - 1]!)
      // each step scales area by 0.7 → width by sqrt(0.7) ≈ 0.8367
      expect(widths[i]! / widths[i - 1]!).toBeGreaterThan(0.8)
      expect(widths[i]! / widths[i - 1]!).toBeLessThan(0.87)
    }
  })

  it('stops when the predicted file size drops below 10KB', () => {
    // tiny source file: predicted size falls under 10KB after the first shrink
    const widths = calc.calculateWidths(12 * 1024, 800, 600)
    expect(widths).toEqual([800])
  })

  it('stops before emitting widths under 20px', () => {
    const widths = calc.calculateWidths(50_000_000, 100, 100)
    expect(widths.every((w) => w >= 20)).toBe(true)
  })

  it('returns integer widths', () => {
    const widths = calc.calculateWidths(1_000_000, 2411, 1017)
    expect(widths.every((w) => Number.isInteger(w))).toBe(true)
  })
})

describe('responsiveFileName', () => {
  it('builds {base}___{conversion}_{w}_{h}{ext}', () => {
    expect(responsiveFileName('photo.jpg', 'thumb', 800, 600, null)).toBe('photo___thumb_800_600.jpg')
  })
  it('honors an output format override', () => {
    expect(responsiveFileName('photo.jpg', 'original', 320, 240, 'webp')).toBe('photo___original_320_240.webp')
  })
  it('handles extensionless names', () => {
    expect(responsiveFileName('file', 'original', 100, 50, null)).toBe('file___original_100_50')
  })
})
```

- [ ] **Step 2: Run to verify failure**: `pnpm --filter @node-media-library/core test -- responsive-widths` → FAIL (modules don't exist).

- [ ] **Step 3: Implement.** `packages/core/src/responsive/types.ts`:

```ts
export interface ResponsiveVariant {
  fileName: string
  width: number
  height: number
}

/** Stored under `MediaRecord.responsiveImages[conversionName]`. */
export interface ResponsiveImagesEntry {
  files: ResponsiveVariant[]
  /** base64 SVG data URI (LQIP); absent when placeholders are disabled. */
  placeholder?: string
}
```

`packages/core/src/responsive/width-calculator.ts` (direct port of Spatie's `FileSizeOptimizedWidthCalculator`):

```ts
export interface WidthCalculator {
  calculateWidths(fileSizeBytes: number, width: number, height: number): number[]
}

const MIN_PREDICTED_SIZE = 10 * 1024
const MIN_WIDTH = 20

/**
 * Port of Spatie's FileSizeOptimizedWidthCalculator: each successive variant
 * targets ~70% of the previous predicted file size. Since file size scales
 * with pixel area at constant "pixel price" (bytes per pixel), width shrinks
 * by sqrt(0.7) per step. Stops once the predicted size drops below 10KB or
 * the width below 20px.
 */
export class FileSizeOptimizedWidthCalculator implements WidthCalculator {
  calculateWidths(fileSizeBytes: number, width: number, height: number): number[] {
    const targetWidths: number[] = [Math.floor(width)]
    const ratio = height / width
    const area = height * width
    const pixelPrice = fileSizeBytes / area

    let predictedFileSize = fileSizeBytes
    for (;;) {
      predictedFileSize *= 0.7
      const newWidth = Math.floor(Math.sqrt(predictedFileSize / pixelPrice / ratio))
      if (predictedFileSize < MIN_PREDICTED_SIZE || newWidth < MIN_WIDTH) {
        return targetWidths
      }
      targetWidths.push(newWidth)
    }
  }
}
```

`packages/core/src/responsive/naming.ts`:

```ts
import { extname, basename } from 'node:path'

/**
 * `'photo.jpg','thumb',800,600,null` → `'photo___thumb_800_600.jpg'`.
 * `format` overrides the output extension (mirrors conversionFileName).
 */
export function responsiveFileName(
  originalFileName: string,
  conversionName: string,
  width: number,
  height: number,
  format: string | null,
): string {
  const ext = extname(originalFileName)
  const base = basename(originalFileName, ext)
  const outExt = format ? `.${format}` : ext
  return `${base}___${conversionName}_${width}_${height}${outExt}`
}
```

- [ ] **Step 4: Run tests**: `pnpm --filter @node-media-library/core test -- responsive-widths` → PASS.

- [ ] **Step 5: Commit**:

```bash
git add packages/core/src/responsive packages/core/test/responsive-widths.test.ts
git commit -m "feat(core): responsive width calculator, variant naming and types"
```

---

### Task 3: Sharp variant renderer + LQIP placeholder

**Files:**
- Create: `packages/core/src/responsive/generator.ts`
- Test: `packages/core/test/responsive-generator.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (pure sharp helpers).
- Produces:
  - `renderVariant(input: Buffer, width: number, format: 'jpeg'|'png'|'webp'|'avif'|null, quality: number | null): Promise<RenderedVariant>` where `interface RenderedVariant { buffer: Buffer; width: number; height: number }` — resizes to `width` preserving aspect ratio (widths always come from the source's own width so they only shrink), converts to `format` when given, reports actual output dimensions.
  - `tinyPlaceholder(input: Buffer): Promise<string>` — returns a `data:image/svg+xml;base64,...` URI: a 32px-wide blurred jpeg embedded in an SVG sized to the source's intrinsic dimensions.

- [ ] **Step 1: Write failing tests** in `packages/core/test/responsive-generator.test.ts` (build the fixture with sharp at runtime — no binary fixtures needed):

```ts
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { renderVariant, tinyPlaceholder } from '../src/responsive/generator.js'

async function fixture(width = 1200, height = 900): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } },
  })
    .jpeg()
    .toBuffer()
}

describe('renderVariant', () => {
  it('resizes to the requested width preserving aspect ratio', async () => {
    const out = await renderVariant(await fixture(), 600, null, null)
    expect(out.width).toBe(600)
    expect(out.height).toBe(450)
    const meta = await sharp(out.buffer).metadata()
    expect(meta.width).toBe(600)
    expect(meta.format).toBe('jpeg')
  })

  it('converts to the requested format', async () => {
    const out = await renderVariant(await fixture(), 300, 'webp', 60)
    expect((await sharp(out.buffer).metadata()).format).toBe('webp')
  })
})

describe('tinyPlaceholder', () => {
  it('returns a base64 SVG data URI embedding a blurred jpeg', async () => {
    const uri = await tinyPlaceholder(await fixture())
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const svg = Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('data:image/jpeg;base64,')
    expect(svg).toContain('viewBox="0 0 1200 900"')
  })
})
```

- [ ] **Step 2: Run to verify failure**: `pnpm --filter @node-media-library/core test -- responsive-generator` → FAIL.

- [ ] **Step 3: Implement** `packages/core/src/responsive/generator.ts`:

```ts
export interface RenderedVariant {
  buffer: Buffer
  width: number
  height: number
}

export async function renderVariant(
  input: Buffer,
  width: number,
  format: 'jpeg' | 'png' | 'webp' | 'avif' | null,
  quality: number | null,
): Promise<RenderedVariant> {
  const sharp = (await import('sharp')).default
  let pipeline = sharp(input).rotate().resize({ width })
  if (format) {
    pipeline = pipeline.toFormat(format, { quality: quality ?? undefined })
  }
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  return { buffer: data, width: info.width, height: info.height }
}

/**
 * LQIP: a 32px blurred jpeg wrapped in an SVG at the source's intrinsic
 * dimensions (so the placeholder reserves the right layout box), returned as
 * a base64 SVG data URI. Port of Spatie's approach.
 */
export async function tinyPlaceholder(input: Buffer): Promise<string> {
  const sharp = (await import('sharp')).default
  const image = sharp(input).rotate()
  const meta = await image.metadata()
  const width = meta.width ?? 32
  const height = meta.height ?? 32
  const tiny = await image.resize({ width: 32 }).blur(2).jpeg({ quality: 50 }).toBuffer()
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${width} ${height}"><filter id="b" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur stdDeviation="1"/></filter>` +
    `<image filter="url(#b)" x="0" y="0" width="100%" height="100%" ` +
    `xlink:href="data:image/jpeg;base64,${tiny.toString('base64')}"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}
```

- [ ] **Step 4: Run tests**: `pnpm --filter @node-media-library/core test -- responsive-generator` → PASS.

- [ ] **Step 5: Commit**:

```bash
git add packages/core/src/responsive/generator.ts packages/core/test/responsive-generator.test.ts
git commit -m "feat(core): sharp responsive variant renderer and LQIP placeholder"
```

---

### Task 4: Engine integration — generate responsive variants, `'original'` sentinel, event, dispatch

**Files:**
- Modify: `packages/core/src/events.ts` (add event)
- Modify: `packages/core/src/conversions/engine.ts`
- Modify: `packages/core/src/library.ts` (new engine deps only)
- Modify: `packages/core/src/config.ts` (config knobs)
- Modify: `packages/core/src/pipeline/file-adder.ts` (dispatch `'original'`)
- Test: `packages/core/test/responsive-engine.test.ts`

**Interfaces:**
- Consumes: Task 1's `markConversionGenerated`/`mergeResponsiveImages`, Task 2's `FileSizeOptimizedWidthCalculator`/`responsiveFileName`/`ResponsiveImagesEntry`/`ResponsiveVariant`, Task 3's `renderVariant`/`tinyPlaceholder`.
- Produces:
  - `MediaEventMap` gains `'responsive:generated': { media: MediaRecord; conversion: string }`.
  - `ConversionEngineDeps` gains: `collectionFor(modelType: string, collection: string): CollectionDefinition`, `widthCalculator: WidthCalculator`, `responsivePlaceholders: boolean`.
  - `ConversionEngine.wantsOriginalResponsive(media: MediaRecord): boolean` — true when the media's collection definition has `responsiveImages: true` OR `media.responsiveImages['requested'] === true` (the per-add flag FileAdder stores).
  - `ConversionEngine.perform(mediaId, names?)` understands the `'original'` sentinel inside `names`: it is never treated as a conversion; it triggers responsive generation from the original file. When `names` is omitted (regenerate-everything path), original responsive regenerates whenever `wantsOriginalResponsive` is true.
  - `MediaLibraryConfig` gains `responsiveWidthCalculator?: WidthCalculator` (default `new FileSizeOptimizedWidthCalculator()`) and `responsivePlaceholders?: boolean` (default `true`).
  - FileAdder: when `wantsOriginalResponsive(record)` is true, `'original'` is appended to the **queued** names (responsive generation is heavy; it always goes through the queue driver).

- [ ] **Step 1: Add the event.** In `packages/core/src/events.ts`, add to `MediaEventMap`:

```ts
  'responsive:generated': { media: MediaRecord; conversion: string }
```

- [ ] **Step 2: Add config knobs.** In `packages/core/src/config.ts`, add to `MediaLibraryConfig`:

```ts
  /** Default `new FileSizeOptimizedWidthCalculator()`. */
  responsiveWidthCalculator?: WidthCalculator
  /** Generate LQIP placeholders for responsive variants. Default true. */
  responsivePlaceholders?: boolean
```

Add to `ResolvedConfig`: `readonly responsiveWidthCalculator: WidthCalculator` and `readonly responsivePlaceholders: boolean`; resolve them in `resolveConfig()` (`config.responsiveWidthCalculator ?? new FileSizeOptimizedWidthCalculator()`, `config.responsivePlaceholders ?? true`). Import from `./responsive/width-calculator.js`.

- [ ] **Step 3: Write failing engine tests** in `packages/core/test/responsive-engine.test.ts`. Use the same scaffolding style as `packages/core/test/conversions.test.ts` (in-memory repository, fs disk in a temp dir via the storage resolver, a real jpeg fixture built with sharp — read that file first and mirror its setup helpers). Cases — expand EVERY one into a real vitest `it()` with concrete assertions (this list is the case inventory, not the test code):

```ts
// 1. add() with collection.withResponsiveImages() + syncDriver:
//    - files exist under `${media.id}/responsive/` matching /___original_\d+_\d+\.jpe?g$/
//    - record.responsiveImages.original.files is a non-empty array of
//      { fileName, width, height }, widths strictly descending
//    - record.responsiveImages.original.placeholder starts with 'data:image/svg+xml;base64,'
//    - a 'responsive:generated' event fired with conversion 'original'
// 2. conversion().withResponsiveImages() (e.g. name 'preview', format 'webp', nonQueued):
//    - variants exist matching /___preview_\d+_\d+\.webp$/
//    - responsiveImages.preview present; generatedConversions.preview true
// 3. responsivePlaceholders: false → entry has no `placeholder` key
// 4. media with NO responsive opt-in anywhere → responsiveImages stays {} and
//    no files under responsive/
// 5. perform(mediaId, ['original']) on a record whose collection has
//    withResponsiveImages() regenerates the entry (call after wiping
//    record.responsiveImages via repository.update) — the sentinel path
// 6. FileAdder.withResponsiveImages() (per-add, plain default collection) also
//    triggers original variants
```

- [ ] **Step 4: Run to verify failure**: `pnpm --filter @node-media-library/core test -- responsive-engine` → FAIL.

- [ ] **Step 5: Implement the engine changes** in `packages/core/src/conversions/engine.ts`:

Extend deps (new imports: `CollectionDefinition` from `../definitions/collection.js`, `WidthCalculator` from `../responsive/width-calculator.js`, `responsiveFileName` from `../responsive/naming.js`, `renderVariant`, `tinyPlaceholder` from `../responsive/generator.js`, `ResponsiveVariant`, `ResponsiveImagesEntry` from `../responsive/types.js`):

```ts
export interface ConversionEngineDeps {
  // ...existing...
  collectionFor(modelType: string, collection: string): CollectionDefinition
  widthCalculator: WidthCalculator
  responsivePlaceholders: boolean
}
```

Add the opt-in check and the generation helper:

```ts
  /** Collection-level withResponsiveImages() OR the per-add requested flag. */
  wantsOriginalResponsive(media: MediaRecord): boolean {
    if (this.deps.collectionFor(media.modelType, media.collectionName).responsiveImages) return true
    return media.responsiveImages['requested'] === true
  }

  /**
   * Renders responsive variants of `source` under `conversionName`, writes
   * them to `{directory}/responsive/` on the media's own disk, records the
   * entry atomically and emits `responsive:generated`. `format`/`quality`
   * come from the conversion definition (null for the original).
   */
  private async generateResponsive(
    media: MediaRecord,
    conversionName: string,
    source: Buffer,
    format: 'jpeg' | 'png' | 'webp' | 'avif' | null,
    quality: number | null,
  ): Promise<void> {
    const sharp = (await import('sharp')).default
    const meta = await sharp(source).rotate().metadata()
    if (!meta.width || !meta.height) return

    const widths = this.deps.widthCalculator.calculateWidths(source.byteLength, meta.width, meta.height)
    const disk = await this.deps.storage.disk(media.disk)
    const dir = this.deps.pathGenerator.responsivePath(media)

    const files: ResponsiveVariant[] = []
    for (const width of widths) {
      const variant = await renderVariant(source, width, format, quality)
      const fileName = responsiveFileName(media.fileName, conversionName, variant.width, variant.height, format)
      await disk.put(`${dir}/${fileName}`, variant.buffer)
      files.push({ fileName, width: variant.width, height: variant.height })
    }

    const entry: ResponsiveImagesEntry = { files }
    if (this.deps.responsivePlaceholders) {
      entry.placeholder = await tinyPlaceholder(source)
    }

    const updated = await this.deps.repository.mergeResponsiveImages(media.id, conversionName, { ...entry })
    this.deps.events.emit('responsive:generated', { media: snapshot(updated), conversion: conversionName })
  }
```

Rework `perform()`:
- Split the sentinel out of `names`: `const originalExplicit = names?.includes('original') ?? false` and `const conversionNames = names?.filter((n) => n !== 'original')`; the entries filter uses `conversionNames`.
- `const runOriginal = originalExplicit || (names === undefined && this.wantsOriginalResponsive(media))`.
- Early-return guard becomes `if (entries.length === 0 && !runOriginal) return` (the `!media` and `!generator` guards stay first and unchanged — no generator means no responsive either).
- Load the original buffer as today (it's now needed by both paths).
- Run original responsive FIRST (before the conversion loop) when `runOriginal`: wrap in try/catch — on failure, if `entries.length === 0` rethrow (the call did nothing else), otherwise `console.warn('[media-library] responsive generation for the original failed:', err)` and continue with conversions. Document exactly this in a comment.
- After a successful conversion whose `def.responsiveImages` is true, call `await this.generateResponsive(media, name, output, def.format, def.quality)` BEFORE the `markConversionGenerated`/`conversion:completed` emit — a failure inside it lands in the existing per-conversion catch and counts as that conversion's failure.

- [ ] **Step 6: Wire the new deps in `MediaLibrary`** (`packages/core/src/library.ts`): in the `new ConversionEngine({...})` call add:

```ts
      collectionFor: (modelType, collection) => this.getCollectionDefinition(modelType, collection),
      widthCalculator: this.resolved.responsiveWidthCalculator,
      responsivePlaceholders: this.resolved.responsivePlaceholders,
```

- [ ] **Step 7: FileAdder dispatch.** In `packages/core/src/pipeline/file-adder.ts` `dispatchConversions()`, after building `queuedNames`:

```ts
    if (this.library.conversionEngine.wantsOriginalResponsive(record)) {
      queuedNames.push('original')
    }
```

(Also update the `withResponsiveImages()` doc comment on FileAdder: the engine now exists.)

- [ ] **Step 8: Run the new tests + full core suite**: `pnpm --filter @node-media-library/core test` → all PASS.

- [ ] **Step 9: Commit**:

```bash
git add -A
git commit -m "feat(core): responsive variant generation wired into conversion engine and dispatch"
```

---

### Task 5: Read surface — srcset/responsiveUrls/placeholder, regenerate `withResponsive`, spec update

**Files:**
- Modify: `packages/core/src/storage/url-generator.ts`
- Modify: `packages/core/src/library.ts`
- Modify: `packages/core/src/conversions/engine.ts` (`RegenerateOptions`)
- Modify: `docs/superpowers/specs/2026-07-26-node-media-library-design.md` (§9 stored-shape + srcset wording)
- Test: `packages/core/test/responsive-urls.test.ts`

**Interfaces:**
- Consumes: Task 2's `ResponsiveImagesEntry`, Task 4's stored entries and `wantsOriginalResponsive`.
- Produces:
  - `UrlGenerator` interface gains an **optional** member `responsiveUrl?(media: MediaRecord, fileName: string): Promise<string>`; `DefaultUrlGenerator` implements it (path `${pathGen.responsivePath(media)}/${fileName}` on `media.disk`, same fs-baseUrl/getUrl/versioning logic as `url()` — extract the shared "public URL for path on disk" piece into a private helper rather than duplicating it).
  - `MediaLibrary.responsiveUrls(mediaOrId: MediaRecord | string, conversion = 'original'): Promise<string[]>` — URLs widest-first; `[]` when no entry; throws `MediaLibraryError` for unknown id; returns `[]` (not a throw) when the configured urlGenerator lacks `responsiveUrl`.
  - `MediaLibrary.srcset(mediaOrId, conversion = 'original'): Promise<string | null>` — `'url1 800w, url2 669w'`; `null` when no entry/empty files.
  - `MediaLibrary.placeholder(mediaOrId, conversion = 'original'): Promise<string | null>`.
  - `RegenerateOptions` gains `withResponsive?: boolean` — when true, `'original'` is appended to each record's dispatch names when `wantsOriginalResponsive(record)`; under `onlyMissing`, only when `record.responsiveImages['original']` is absent.

- [ ] **Step 1: Write failing tests** in `packages/core/test/responsive-urls.test.ts` (reuse the Task-4 scaffolding: fs disk with `baseUrl` configured so public URLs resolve). Cases — each as a real `it()`:

```ts
// 1. after add() with responsive collection: responsiveUrls(media.id) returns
//    one URL per stored file, widest first, each ending with the stored
//    fileName under `/${media.id}/responsive/`
// 2. srcset(media.id): equals files mapped to `${url} ${width}w` joined by ', '
// 3. placeholder(media.id) starts with 'data:image/svg+xml;base64,'
// 4. srcset for a conversion name: srcset(media.id, 'preview') non-null when
//    the 'preview' conversion has withResponsiveImages()
// 5. srcset/responsiveUrls/placeholder on media with no entry → null / [] / null
// 6. regenerate({ withResponsive: true }) after wiping responsiveImages via
//    repository.update: entry comes back (syncDriver); then
//    regenerate({ withResponsive: true, onlyMissing: true }) → { enqueued: 0 }
//    for that record (use a collection whose only derived output is
//    responsive-original — no conversions — to keep counts unambiguous)
```

- [ ] **Step 2: Run to verify failure**: `pnpm --filter @node-media-library/core test -- responsive-urls` → FAIL.

- [ ] **Step 3: Implement `responsiveUrl` in the URL generator.** In `packages/core/src/storage/url-generator.ts`: add the optional interface member, then in `DefaultUrlGenerator` extract the body of `url()` into `private async publicUrlFor(path: string, diskName: string, media: MediaRecord): Promise<string>` (fs-baseUrl branch, getUrl branch, versioning suffix, StorageError wrap) and implement:

```ts
  async responsiveUrl(media: MediaRecord, fileName: string): Promise<string> {
    return this.publicUrlFor(`${this.pathGen.responsivePath(media)}/${fileName}`, media.disk, media)
  }
```

`url()` becomes `resolveTarget` + `publicUrlFor`.

- [ ] **Step 4: Implement the library read surface** in `packages/core/src/library.ts` (import `ResponsiveImagesEntry` from `./responsive/types.js`):

```ts
  private async requireMedia(mediaOrId: MediaRecord | string): Promise<MediaRecord> {
    const media =
      typeof mediaOrId === 'string' ? await this.resolved.repository.findById(mediaOrId) : mediaOrId
    if (!media) throw new MediaLibraryError('media not found')
    return media
  }

  private responsiveEntry(media: MediaRecord, conversion: string): ResponsiveImagesEntry | null {
    const entry = media.responsiveImages[conversion]
    if (!entry || typeof entry !== 'object') return null
    return entry as unknown as ResponsiveImagesEntry
  }

  async responsiveUrls(mediaOrId: MediaRecord | string, conversion = 'original'): Promise<string[]> {
    const media = await this.requireMedia(mediaOrId)
    const entry = this.responsiveEntry(media, conversion)
    if (!entry?.files?.length || !this.urlGeneratorInstance.responsiveUrl) return []
    return Promise.all(entry.files.map((f) => this.urlGeneratorInstance.responsiveUrl!(media, f.fileName)))
  }

  async srcset(mediaOrId: MediaRecord | string, conversion = 'original'): Promise<string | null> {
    const media = await this.requireMedia(mediaOrId)
    const entry = this.responsiveEntry(media, conversion)
    if (!entry?.files?.length || !this.urlGeneratorInstance.responsiveUrl) return null
    const parts = await Promise.all(
      entry.files.map(async (f) => `${await this.urlGeneratorInstance.responsiveUrl!(media, f.fileName)} ${f.width}w`),
    )
    return parts.join(', ')
  }

  async placeholder(mediaOrId: MediaRecord | string, conversion = 'original'): Promise<string | null> {
    const media = await this.requireMedia(mediaOrId)
    return this.responsiveEntry(media, conversion)?.placeholder ?? null
  }
```

Refactor `deleteMedia()`'s inline media-or-id resolution to use `requireMedia` (same semantics; keeps one code path).

- [ ] **Step 5: Regenerate option.** In `packages/core/src/conversions/engine.ts` add `withResponsive?: boolean` to `RegenerateOptions`. In `library.ts` `regenerate()`'s `dispatch`, after the `only`/`onlyMissing` filters and before the `names.length === 0` early return:

```ts
      if (opts.withResponsive && this.engine.wantsOriginalResponsive(record)) {
        const missing = record.responsiveImages['original'] === undefined
        if (!opts.onlyMissing || missing) names.push('original')
      }
```

(Placed after the filters so `only`/`onlyMissing` — which reason about conversions — never strip the sentinel; `only` intentionally does not gate it.)

- [ ] **Step 6: Update the spec.** In `docs/superpowers/specs/2026-07-26-node-media-library-design.md` §9, replace the stored-shape line and the API line with:

```markdown
- `responsiveImages` JSON: `{ [conversion]: { files: [{ fileName, width, height }], placeholder?: base64svg } }` — file names + dimensions, not URLs (disks are private-by-default and URLs may be signed/expiring; URLs are built at read time).
- API returns data, not HTML: `srcset()` string (real variants only, widest first), `responsiveUrls()`, `placeholder()` (the LQIP data URI, exposed separately — it does not belong inside a `srcset` attribute). Framework view helpers are out of scope for v1.
```

- [ ] **Step 7: Run full core suite**: `pnpm --filter @node-media-library/core test` → all PASS.

- [ ] **Step 8: Commit**:

```bash
git add -A
git commit -m "feat(core): responsive read surface (srcset/responsiveUrls/placeholder) and regenerate withResponsive"
```

---

### Task 6: Integration test, exports, docs

**Files:**
- Create: `packages/core/test/responsive-integration.test.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/test/exports.test.ts`
- Modify: `packages/core/README.md`, `packages/prisma/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: public exports — `WidthCalculator`, `FileSizeOptimizedWidthCalculator`, `responsiveFileName`, `ResponsiveVariant`, `ResponsiveImagesEntry`, `RenderedVariant`, `renderVariant`, `tinyPlaceholder`.

- [ ] **Step 1: Add exports.** In `packages/core/src/index.ts`:

```ts
export * from './responsive/types.js'
export * from './responsive/width-calculator.js'
export * from './responsive/naming.js'
export * from './responsive/generator.js'
```

Extend `packages/core/test/exports.test.ts` with the new names (follow that file's existing pattern; interfaces/types assert via `export type` semantics the way that file already does).

- [ ] **Step 2: Write the spec-§14 integration test** in `packages/core/test/responsive-integration.test.ts`: full cycle on an fs disk in a temp dir with `baseUrl` — one collection with a `preview` conversion (`webp`, `withResponsiveImages()`, `nonQueued()`) plus collection-level `withResponsiveImages()`. One `it()` with sequential assertion blocks:

```ts
// add (sharp-built 1600x1200 jpeg) →
//   conversion file exists; responsive variants exist for BOTH 'original' and 'preview'
// → urlGenerator.url(media, 'preview') resolves to the conversion file path
// → srcset(media.id) and srcset(media.id, 'preview') both non-null; every URL starts with baseUrl
// → placeholder(media.id) is an svg data URI
// → deleteMedia(media.id) → the media directory is fully gone (original,
//   conversions/, responsive/) and repository.findById returns null
```

- [ ] **Step 3: Run the full workspace suite + typecheck**: `pnpm -r test` (bullmq's Redis-gated tests skip without `REDIS_URL` — expected) and the repo's typecheck → green.

- [ ] **Step 4: Update docs.** `packages/core/README.md`: add a "Responsive images" section — opt-in points (`collection().withResponsiveImages()`, `conversion().withResponsiveImages()`, `add().withResponsiveImages()`), read API (`srcset`/`responsiveUrls`/`placeholder`), config knobs (`responsiveWidthCalculator`, `responsivePlaceholders`), storage layout `{mediaId}/responsive/{base}___{conversion}_{w}_{h}.{ext}`, and `regenerate({ withResponsive: true })`. `packages/prisma/README.md`: note the two new repository methods and that custom `PrismaLikeClient` stubs may provide `$transaction` for atomicity (falls back to plain read-merge-write without it).

- [ ] **Step 5: Commit**:

```bash
git add -A
git commit -m "feat(core): responsive images exports, integration test and docs"
```

---

## Self-review notes (done at planning time)

- Spec §9 coverage: width calculator ✓ (T2), file layout ✓ (T2/T4), pseudo-conversion `original` ✓ (T4), JSON shape ✓ (deviation documented, spec updated in T5), LQIP default-on/disable ✓ (T4 `responsivePlaceholders`), data-not-HTML API ✓ (T5). Spec §12 `responsive:generated` ✓ (T4). Spec §13 `--with-responsive` programmatic option ✓ (T5; the CLI itself is Plan 6). Spec §14 integration cycle ✓ (T6).
- Plan-3 prerequisite (atomic merge before responsive reuses read-merge-write) is Task 1, and everything responsive-related writes through `mergeResponsiveImages` only.
- Type consistency: `ResponsiveImagesEntry`/`ResponsiveVariant` defined T2, consumed with identical shapes in T4 (engine), T5 (library reads), T6 (exports). `wantsOriginalResponsive` defined T4, consumed T4 (FileAdder) and T5 (regenerate). Repository method names identical across T1 interface/in-memory/prisma/contract and T4/T5 call sites.
