# PDF + Video Generator Packages Implementation Plan (Plan 5 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@node-media-library/pdf` and `@node-media-library/video` — ImageGenerators that turn PDF pages (via poppler's `pdftoppm`) and video frames (via `ffmpeg`) into raster sources for the existing conversion + responsive pipeline — plus the core seam that routes original-responsive generation through the supporting generator.

**Architecture:** Core's `ImageGenerator` interface gains an optional `toSourceImage?(input)` member; the engine uses it so a PDF/video original never hits sharp raw (the Plan-4 review prerequisite). Each new package wraps one external binary behind a tiny spawn helper with temp-file plumbing, composes core's `sharpImageGenerator()` for the actual conversion math (`toImage` = render page/frame → hand the raster to sharp), and exposes an availability check that gates the real-binary tests — mirroring how bullmq's tests gate on `REDIS_URL`. Command construction is pure and unit-tested without binaries.

**Tech Stack:** TypeScript ESM (`.js` suffixes), `node:child_process` execFile + `node:fs/promises` temp dirs, sharp ^0.35 (via core), poppler `pdftoppm` and `ffmpeg` as system binaries (NOT npm deps), vitest, pnpm workspaces.

## Global Constraints

- Node floor `>=20`; flydrive stays `^1.3.0`. No version bumps.
- **No new npm runtime dependencies anywhere in this plan.** The pdf/video packages depend only on `@node-media-library/core` (`workspace:*`) + dev tooling; the binaries are system requirements, documented, never installed by the package.
- All imports use explicit `.js` suffixes.
- `MediaEventMap` stays an `interface`.
- Binary-gated tests use `describe.runIf(available)` where `available` is probed once in the test file via the package's exported availability helper — on machines without the binary the suite must PASS with skips, never fail. **This dev machine has neither `pdftoppm` nor `ffmpeg`** — the implementer runs the gated suites knowing they'll skip; the pure tests are the local safety net.
- Never spawn with `shell: true`; always `execFile` with an args array (no shell injection via file names).
- Temp files: `mkdtemp(join(tmpdir(), 'nml-'))`, always removed in `finally` with `rm(dir, { recursive: true, force: true })`.
- Package scaffold mirrors `packages/bullmq` exactly: `package.json` (`"type": "module"`, `exports: { ".": "./src/index.ts" }`, scripts `test`/`typecheck`), `tsconfig.json` extending `../../tsconfig.base.json` with `include: ["src", "test"]`, `vitest.config.ts` with `test.include: ['test/**/*.test.ts']`.
- Test commands: `pnpm --filter @node-media-library/pdf test`, `pnpm --filter @node-media-library/video test`, `pnpm --filter @node-media-library/core test`; typecheck via `pnpm -r typecheck`.
- Commit after every task; conventional commit messages; never `git add -A` (stage the task's files explicitly).

## Design decisions (made at planning time)

- **Spec §9 "self-register when installed" is replaced by explicit registration.** ESM has no reliable install-detection side channel, and this library's philosophy is explicit config. Users write `imageGenerators: [sharpImageGenerator(), pdfImageGenerator(), videoImageGenerator()]`. Task 1 updates the spec sentence.
- **`ImageGenerator.toImage` keeps its `Buffer` input.** The Plan-4 note suggested `Buffer | { path }`; instead, generators that need a file on disk (both of these) write the buffer to a temp file internally. No interface break, no caller today needs paths. Documented in the interface JSDoc.
- **`toSourceImage?(input: Buffer): Promise<Buffer>`** is the new optional member: "render me a default raster of this source" (PDF page 1 / video frame at 0s) — used by the engine for original-responsive variants. Absence means the input is already sharp-readable.
- The two packages deliberately duplicate a ~25-line spawn helper rather than sharing an internal package — two copies beat a third publishable unit.

## File Structure

- Modify: `packages/core/src/conversions/image-generator.ts` — optional `toSourceImage` member
- Modify: `packages/core/src/conversions/engine.ts` — route original responsive through `toSourceImage`
- Modify: `docs/superpowers/specs/2026-07-26-node-media-library-design.md` §9 registration sentence
- Create: `packages/pdf/{package.json,tsconfig.json,vitest.config.ts,README.md}`
- Create: `packages/pdf/src/{index.ts,args.ts,run.ts,generator.ts}`
- Create: `packages/pdf/test/{args.test.ts,generator.test.ts,fixture.ts,integration.test.ts}`
- Create: `packages/video/{package.json,tsconfig.json,vitest.config.ts,README.md}` and mirrored `src/`+`test/`
- Modify: `packages/core/README.md` (generator registration section)

---

### Task 1: Core seam — `toSourceImage` routing for original responsive variants

**Files:**
- Modify: `packages/core/src/conversions/image-generator.ts`
- Modify: `packages/core/src/conversions/engine.ts` (the `runOriginal` block in `perform()`)
- Modify: `docs/superpowers/specs/2026-07-26-node-media-library-design.md` (§9)
- Test: `packages/core/test/responsive-engine.test.ts` (append two tests)

**Interfaces:**
- Consumes: existing `ImageGenerator`, `ConversionEngine.perform`, `generateResponsive`.
- Produces (later tasks rely on this): `ImageGenerator.toSourceImage?(input: Buffer): Promise<Buffer>` — optional; when present, `perform()` uses its output (instead of the raw original bytes) as the source for `'original'` responsive variants. Conversion outputs are unaffected (they're already raster).

- [ ] **Step 1: Write two failing tests** appended to `packages/core/test/responsive-engine.test.ts` (reuse that file's existing scaffolding — in-memory repo, temp fs disk, sharp-built jpeg helper; read it first):

```ts
  it('routes original responsive generation through toSourceImage when the generator provides it', async () => {
    let sourceCalls = 0
    const fakeGenerator: ImageGenerator = {
      supports: (mime) => mime === 'application/x-fake',
      toImage: async () => makeJpeg(400, 300),          // use the file's existing fixture helper name
      toSourceImage: async () => {
        sourceCalls += 1
        return makeJpeg(800, 600)
      },
    }
    const { media: library, repository } = makeLibrary({ imageGenerators: [fakeGenerator] }) // adapt to the file's setup helper
    const record = await library.for('User', 'u1').add({ buffer: await makeJpeg(10, 10) }).toCollection('default')
    await repository.update(record.id, { mimeType: 'application/x-fake', responsiveImages: { requested: true } })

    await library.performConversions(record.id, ['original'])

    expect(sourceCalls).toBe(1)
    const updated = await repository.findById(record.id)
    const entry = updated?.responsiveImages['original'] as { files: Array<{ width: number }> }
    expect(entry.files.length).toBeGreaterThan(0)
    expect(entry.files[0]!.width).toBe(800) // widths derive from the 800px toSourceImage output, not the 10px original
  })

  it('generators without toSourceImage keep the raw-original behavior', async () => {
    // run the file's existing collection-level withResponsiveImages() jpeg flow
    // (real sharpImageGenerator, no toSourceImage) and assert entry.files[0].width
    // equals the uploaded jpeg's own width — proving the absent-member path is untouched
  })
```

Expand the second test fully using the file's existing helpers; adapt helper names (`makeJpeg`, `makeLibrary`, source shape) to what the file actually defines — the assertions above are the contract.

- [ ] **Step 2: Run to verify failure**: `pnpm --filter @node-media-library/core test -- responsive-engine` → FAIL (first test: type error / `sourceCalls` 0 / widths from the 10px original).

- [ ] **Step 3: Add the interface member** in `packages/core/src/conversions/image-generator.ts`:

```ts
export interface ImageGenerator {
  supports(mimeType: string | null): boolean
  /**
   * Applies `def` to the source and returns the derived raster. `input` is
   * always the full source file's bytes; generators needing a real file
   * (pdf/video binaries) write a temp file internally.
   */
  toImage(input: Buffer, def: ConversionDefinition): Promise<Buffer>
  /**
   * Optional: renders a plain, conversion-free raster of the source (e.g.
   * PDF page 1, video frame at 0s) for use as the original-responsive
   * source. Absent means `input` is already a sharp-readable image.
   */
  toSourceImage?(input: Buffer): Promise<Buffer>
}
```

(Keep the existing `sharpImageGenerator()` object literal unchanged — it simply doesn't define the optional member.)

- [ ] **Step 4: Route it in the engine.** In `packages/core/src/conversions/engine.ts`, inside the `runOriginal` try block, replace `await this.generateResponsive(media, 'original', originalBuffer, null, null)` with:

```ts
        // Non-image sources (PDF, video) must be rasterized before sharp
        // sees them; generators that need this declare toSourceImage.
        const responsiveSource = generator.toSourceImage
          ? await generator.toSourceImage(originalBuffer)
          : originalBuffer
        await this.generateResponsive(media, 'original', responsiveSource, null, null)
```

(A `toSourceImage` failure lands in the existing catch: rethrow when no conversion entries, else warn-and-continue — unchanged policy.)

- [ ] **Step 5: Update spec §9.** In `docs/superpowers/specs/2026-07-26-node-media-library-design.md`, replace the sentence fragment `` `pdf`/`video` packages self-register when installed `` with: `` `pdf`/`video` packages export generators the user appends via config (`imageGenerators: [sharpImageGenerator(), pdfImageGenerator(), ...]`) — no install-time magic ``. In the same §9 generator sentence, note the optional `toSourceImage(input)` member (conversion-free raster used as the original-responsive source).

- [ ] **Step 6: Run tests**: `pnpm --filter @node-media-library/core test` → all PASS.

- [ ] **Step 7: Commit**:

```bash
git add packages/core/src/conversions/image-generator.ts packages/core/src/conversions/engine.ts packages/core/test/responsive-engine.test.ts docs/superpowers/specs/2026-07-26-node-media-library-design.md
git commit -m "feat(core): toSourceImage generator seam so non-image originals rasterize before responsive generation"
```

---

### Task 2: `@node-media-library/pdf` package

**Files:**
- Create: `packages/pdf/package.json`, `packages/pdf/tsconfig.json`, `packages/pdf/vitest.config.ts`
- Create: `packages/pdf/src/args.ts`, `packages/pdf/src/run.ts`, `packages/pdf/src/generator.ts`, `packages/pdf/src/index.ts`
- Create: `packages/pdf/test/fixture.ts` (the programmatic PDF fixture, shared with Task 4)
- Create: `packages/pdf/README.md`
- Test: `packages/pdf/test/args.test.ts`, `packages/pdf/test/generator.test.ts`

**Interfaces:**
- Consumes: core's `ImageGenerator`, `ConversionDefinition`, `sharpImageGenerator` (all exported from `@node-media-library/core`); Task 1's `toSourceImage` member.
- Produces:
  - `pdfImageGenerator(opts?: PdfGeneratorOptions): ImageGenerator` where `interface PdfGeneratorOptions { pdftoppmPath?: string; dpi?: number }` (defaults `'pdftoppm'`, `150`).
  - `pdftoppmAvailable(binaryPath?: string): Promise<boolean>`.
  - `buildPdftoppmArgs(page: number, dpi: number, pdfPath: string, outPrefix: string): string[]` (pure).
  - `makeMinimalPdf(): Buffer` in `test/fixture.ts` (Task 4 imports it).

- [ ] **Step 1: Scaffold the package.** `packages/pdf/package.json`:

```json
{
  "name": "@node-media-library/pdf",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@node-media-library/core": "workspace:*" },
  "devDependencies": {
    "sharp": "^0.35.3",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`. `vitest.config.ts`: copy bullmq's. Run `pnpm install` at the repo root so the workspace links the new package.

- [ ] **Step 2: Write failing pure tests** in `packages/pdf/test/args.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPdftoppmArgs } from '../src/args.js'

describe('buildPdftoppmArgs', () => {
  it('renders exactly one page as png at the given dpi with -singlefile', () => {
    expect(buildPdftoppmArgs(3, 150, '/tmp/in.pdf', '/tmp/out')).toEqual([
      '-png', '-r', '150', '-f', '3', '-l', '3', '-singlefile', '/tmp/in.pdf', '/tmp/out',
    ])
  })
})
```

- [ ] **Step 3: Run to verify failure**: `pnpm --filter @node-media-library/pdf test` → FAIL (module missing).

- [ ] **Step 4: Implement.** `packages/pdf/src/args.ts`:

```ts
/** Pure arg builder for `pdftoppm` — one page, PNG, output at `${outPrefix}.png`. */
export function buildPdftoppmArgs(page: number, dpi: number, pdfPath: string, outPrefix: string): string[] {
  return ['-png', '-r', String(dpi), '-f', String(page), '-l', String(page), '-singlefile', pdfPath, outPrefix]
}
```

`packages/pdf/src/run.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** True when `binaryPath -v` runs at all (pdftoppm prints its version to stderr). */
export async function pdftoppmAvailable(binaryPath = 'pdftoppm'): Promise<boolean> {
  try {
    await execFileAsync(binaryPath, ['-v'])
    return true
  } catch (err) {
    // ENOENT → not installed; a non-zero exit from an existing binary still proves presence
    return (err as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

/**
 * Writes `pdf` to a temp file, runs `binaryPath args(pdfPath, outPrefix)`,
 * returns `${outPrefix}.png`'s bytes. Temp dir always removed.
 */
export async function renderViaTempFiles(
  binaryPath: string,
  pdf: Buffer,
  args: (pdfPath: string, outPrefix: string) => string[],
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'nml-pdf-'))
  try {
    const pdfPath = join(dir, 'in.pdf')
    const outPrefix = join(dir, 'out')
    await writeFile(pdfPath, pdf)
    await execFileAsync(binaryPath, args(pdfPath, outPrefix))
    return await readFile(`${outPrefix}.png`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
```

`packages/pdf/src/generator.ts`:

```ts
import type { ConversionDefinition, ImageGenerator } from '@node-media-library/core'
import { sharpImageGenerator } from '@node-media-library/core'
import { buildPdftoppmArgs } from './args.js'
import { renderViaTempFiles } from './run.js'

export interface PdfGeneratorOptions {
  /** Path to the poppler `pdftoppm` binary. Default: `'pdftoppm'` (on PATH). */
  pdftoppmPath?: string
  /** Render resolution. Default 150. */
  dpi?: number
}

/**
 * ImageGenerator for PDFs: renders `def.pdfPageNumber` (default 1) with
 * poppler's `pdftoppm`, then applies the conversion through core's sharp
 * pipeline. `toSourceImage` renders page 1 for original-responsive variants.
 * Requires `pdftoppm` on the system — check with `pdftoppmAvailable()`.
 */
export function pdfImageGenerator(opts: PdfGeneratorOptions = {}): ImageGenerator {
  const binary = opts.pdftoppmPath ?? 'pdftoppm'
  const dpi = opts.dpi ?? 150
  const sharpGen = sharpImageGenerator()

  const renderPage = (input: Buffer, page: number): Promise<Buffer> =>
    renderViaTempFiles(binary, input, (pdfPath, outPrefix) => buildPdftoppmArgs(page, dpi, pdfPath, outPrefix))

  return {
    supports(mimeType) {
      return mimeType === 'application/pdf'
    },
    async toImage(input: Buffer, def: ConversionDefinition): Promise<Buffer> {
      const pageImage = await renderPage(input, def.pdfPageNumber)
      return sharpGen.toImage(pageImage, def)
    },
    async toSourceImage(input: Buffer): Promise<Buffer> {
      return renderPage(input, 1)
    },
  }
}
```

`packages/pdf/src/index.ts`:

```ts
export { pdfImageGenerator } from './generator.js'
export type { PdfGeneratorOptions } from './generator.js'
export { pdftoppmAvailable } from './run.js'
export { buildPdftoppmArgs } from './args.js'
```

- [ ] **Step 5: Write the fixture + binary-gated tests.** `packages/pdf/test/fixture.ts` — a minimal valid one-page PDF with a programmatically correct xref table:

```ts
/** Minimal valid one-page PDF (200x100pt blank page) with a correct xref table. */
export function makeMinimalPdf(): Buffer {
  const header = '%PDF-1.4\n'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> >>\nendobj\n',
  ]
  let body = ''
  const offsets: number[] = []
  for (const obj of objects) {
    offsets.push(header.length + body.length)
    body += obj
  }
  const xrefStart = header.length + body.length
  const pad = (n: number) => String(n).padStart(10, '0')
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${pad(o)} 00000 n \n`).join('')
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(header + body + xref + trailer, 'latin1')
}
```

`packages/pdf/test/generator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { conversion } from '@node-media-library/core'
import { pdfImageGenerator } from '../src/generator.js'
import { pdftoppmAvailable } from '../src/run.js'
import { makeMinimalPdf } from './fixture.js'

const available = await pdftoppmAvailable()

describe('pdfImageGenerator (no binary needed)', () => {
  it('supports exactly application/pdf', () => {
    const gen = pdfImageGenerator()
    expect(gen.supports('application/pdf')).toBe(true)
    expect(gen.supports('image/jpeg')).toBe(false)
    expect(gen.supports(null)).toBe(false)
  })
})

describe.runIf(available)('pdfImageGenerator (pdftoppm required)', () => {
  it('toSourceImage renders page 1 as a png with the page aspect ratio', async () => {
    const png = await pdfImageGenerator().toSourceImage!(makeMinimalPdf())
    const meta = await sharp(png).metadata()
    expect(meta.format).toBe('png')
    // 200x100pt page → 2:1 aspect (allow rounding)
    expect(Math.abs(meta.width! / meta.height! - 2)).toBeLessThan(0.05)
  })

  it('toImage applies the conversion to the rendered page', async () => {
    const def = conversion().width(120).format('webp').toDefinition()
    const out = await pdfImageGenerator().toImage(makeMinimalPdf(), def)
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(120)
  })
})

describe.runIf(!available)('pdftoppm missing on this machine', () => {
  it('skips the binary-backed tests (install poppler to run them)', () => {
    expect(available).toBe(false)
  })
})
```

- [ ] **Step 6: Run the suite**: `pnpm --filter @node-media-library/pdf test` → pure tests PASS, gated suite SKIPPED on this machine (no pdftoppm). `pnpm -r typecheck` → clean.

- [ ] **Step 7: Write `packages/pdf/README.md`**: what it is, system requirement (`pdftoppm` from poppler — `brew install poppler` / `apt install poppler-utils`), usage snippet (append `pdfImageGenerator()` to `imageGenerators` alongside `sharpImageGenerator()`), options (`pdftoppmPath`, `dpi`), note that `conversion().pdfPageNumber(n)` selects the page, and that tests skip without the binary.

- [ ] **Step 8: Commit**:

```bash
git add packages/pdf pnpm-lock.yaml
git commit -m "feat(pdf): pdftoppm-backed ImageGenerator package with binary-gated tests"
```

---

### Task 3: `@node-media-library/video` package

**Files:**
- Create: `packages/video/package.json`, `packages/video/tsconfig.json`, `packages/video/vitest.config.ts`
- Create: `packages/video/src/args.ts`, `packages/video/src/run.ts`, `packages/video/src/generator.ts`, `packages/video/src/index.ts`
- Create: `packages/video/README.md`
- Test: `packages/video/test/args.test.ts`, `packages/video/test/generator.test.ts`

**Interfaces:**
- Consumes: core's `ImageGenerator`, `ConversionDefinition`, `sharpImageGenerator`; Task 1's `toSourceImage`.
- Produces:
  - `videoImageGenerator(opts?: VideoGeneratorOptions): ImageGenerator` where `interface VideoGeneratorOptions { ffmpegPath?: string }` (default `'ffmpeg'`).
  - `ffmpegAvailable(binaryPath?: string): Promise<boolean>`.
  - `buildFfmpegFrameArgs(atSecond: number, videoPath: string, outPath: string): string[]` (pure).

- [ ] **Step 1: Scaffold** exactly like Task 2 Step 1 with name `@node-media-library/video` (same scripts, deps `@node-media-library/core: workspace:*`, devDeps sharp/typescript/vitest; same tsconfig/vitest.config). Run `pnpm install` at the root.

- [ ] **Step 2: Write failing pure tests** in `packages/video/test/args.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildFfmpegFrameArgs } from '../src/args.js'

describe('buildFfmpegFrameArgs', () => {
  it('fast-seeks before input and extracts exactly one png frame', () => {
    expect(buildFfmpegFrameArgs(2.5, '/tmp/in.mp4', '/tmp/out.png')).toEqual([
      '-ss', '2.5', '-i', '/tmp/in.mp4', '-frames:v', '1', '-f', 'image2', '-c:v', 'png', '-y', '/tmp/out.png',
    ])
  })
})
```

- [ ] **Step 3: Run to verify failure**: `pnpm --filter @node-media-library/video test` → FAIL.

- [ ] **Step 4: Implement.** `packages/video/src/args.ts`:

```ts
/** Pure arg builder for `ffmpeg`: seek (fast, pre-input), grab 1 frame as png. */
export function buildFfmpegFrameArgs(atSecond: number, videoPath: string, outPath: string): string[] {
  return ['-ss', String(atSecond), '-i', videoPath, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', '-y', outPath]
}
```

`packages/video/src/run.ts`:

```ts
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function ffmpegAvailable(binaryPath = 'ffmpeg'): Promise<boolean> {
  try {
    await execFileAsync(binaryPath, ['-version'])
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

/**
 * Writes `video` to a temp file, runs `binaryPath args(videoPath, outPath)`,
 * returns `outPath`'s bytes. Temp dir always removed.
 */
export async function extractViaTempFiles(
  binaryPath: string,
  video: Buffer,
  args: (videoPath: string, outPath: string) => string[],
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'nml-video-'))
  try {
    const videoPath = join(dir, 'in.bin')
    const outPath = join(dir, 'out.png')
    await writeFile(videoPath, video)
    await execFileAsync(binaryPath, args(videoPath, outPath))
    return await readFile(outPath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
```

`packages/video/src/generator.ts`:

```ts
import type { ConversionDefinition, ImageGenerator } from '@node-media-library/core'
import { sharpImageGenerator } from '@node-media-library/core'
import { buildFfmpegFrameArgs } from './args.js'
import { extractViaTempFiles } from './run.js'

export interface VideoGeneratorOptions {
  /** Path to the ffmpeg binary. Default: `'ffmpeg'` (on PATH). */
  ffmpegPath?: string
}

/**
 * ImageGenerator for videos: extracts the frame at `def.videoFrameAtSecond`
 * (default 0) with ffmpeg, then applies the conversion through core's sharp
 * pipeline. `toSourceImage` extracts the frame at 0s. Requires `ffmpeg` on
 * the system — check with `ffmpegAvailable()`.
 */
export function videoImageGenerator(opts: VideoGeneratorOptions = {}): ImageGenerator {
  const binary = opts.ffmpegPath ?? 'ffmpeg'
  const sharpGen = sharpImageGenerator()

  const extractFrame = (input: Buffer, atSecond: number): Promise<Buffer> =>
    extractViaTempFiles(binary, input, (videoPath, outPath) => buildFfmpegFrameArgs(atSecond, videoPath, outPath))

  return {
    supports(mimeType) {
      return mimeType !== null && mimeType.startsWith('video/')
    },
    async toImage(input: Buffer, def: ConversionDefinition): Promise<Buffer> {
      const frame = await extractFrame(input, def.videoFrameAtSecond)
      return sharpGen.toImage(frame, def)
    },
    async toSourceImage(input: Buffer): Promise<Buffer> {
      return extractFrame(input, 0)
    },
  }
}
```

`packages/video/src/index.ts`: export `videoImageGenerator`, `VideoGeneratorOptions` (type), `ffmpegAvailable`, `buildFfmpegFrameArgs`.

- [ ] **Step 5: Write the binary-gated tests** in `packages/video/test/generator.test.ts` — the fixture is generated BY ffmpeg itself (lavfi test source), so it exists only inside the gated suite:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { conversion } from '@node-media-library/core'
import { videoImageGenerator } from '../src/generator.js'
import { ffmpegAvailable } from '../src/run.js'

const execFileAsync = promisify(execFile)
const available = await ffmpegAvailable()

describe('videoImageGenerator (no binary needed)', () => {
  it('supports any video/* mime and nothing else', () => {
    const gen = videoImageGenerator()
    expect(gen.supports('video/mp4')).toBe(true)
    expect(gen.supports('video/webm')).toBe(true)
    expect(gen.supports('application/pdf')).toBe(false)
    expect(gen.supports(null)).toBe(false)
  })
})

describe.runIf(available)('videoImageGenerator (ffmpeg required)', () => {
  let fixture: Buffer
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nml-video-fixture-'))
    const out = join(dir, 'fixture.mp4')
    // 1s 64x48 synthetic clip; -pix_fmt yuv420p for broad decoder compat
    await execFileAsync('ffmpeg', [
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x48:rate=10',
      '-pix_fmt', 'yuv420p', '-y', out,
    ])
    fixture = await readFile(out)
    return async () => rm(dir, { recursive: true, force: true })
  })

  it('toSourceImage extracts a 64x48 png frame', async () => {
    const png = await videoImageGenerator().toSourceImage!(fixture)
    const meta = await sharp(png).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(64)
    expect(meta.height).toBe(48)
  })

  it('toImage applies the conversion to the extracted frame', async () => {
    const def = conversion().width(32).format('jpeg').videoFrameAtSecond(0.5).toDefinition()
    const out = await videoImageGenerator().toImage(fixture, def)
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(32)
  })
})

describe.runIf(!available)('ffmpeg missing on this machine', () => {
  it('skips the binary-backed tests (install ffmpeg to run them)', () => {
    expect(available).toBe(false)
  })
})
```

- [ ] **Step 6: Run**: `pnpm --filter @node-media-library/video test` → pure PASS, gated SKIPPED locally. `pnpm -r typecheck` → clean.

- [ ] **Step 7: Write `packages/video/README.md`** (mirror Task 2 Step 7: system requirement `ffmpeg`, usage, `videoFrameAtSecond(n)`, options, skip note).

- [ ] **Step 8: Commit**:

```bash
git add packages/video pnpm-lock.yaml
git commit -m "feat(video): ffmpeg-backed ImageGenerator package with binary-gated tests"
```

---

### Task 4: Pipeline integration tests, docs, verification

**Files:**
- Create: `packages/pdf/test/integration.test.ts`
- Create: `packages/video/test/integration.test.ts`
- Modify: `packages/core/README.md` (image-generators registration section)
- Test: full workspace suite

**Interfaces:**
- Consumes: everything above plus core's `createMediaLibrary`, `collection`, `conversion`, `InMemoryMediaRepository`.
- Produces: nothing new — proof the packages work end-to-end through the real pipeline.

- [ ] **Step 1: Write the gated pdf integration test** in `packages/pdf/test/integration.test.ts` — full add → conversion + original responsive on an fs disk. Before writing it, read core's test scaffolding (`packages/core/test/responsive-engine.test.ts`) and mirror how it builds the `storage` config and buffer sources — the shapes below are the contract, adapt exact option names to the real core API:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collection, conversion, createMediaLibrary, InMemoryMediaRepository, sharpImageGenerator,
} from '@node-media-library/core'
import { pdfImageGenerator } from '../src/generator.js'
import { pdftoppmAvailable } from '../src/run.js'
import { makeMinimalPdf } from './fixture.js'

const available = await pdftoppmAvailable()

describe.runIf(available)('pdf end-to-end through the media pipeline', () => {
  it('add(pdf) → thumb conversion generated + original responsive variants rasterized', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-pdf-int-'))
    try {
      const media = createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: { driver: 'fs', root, baseUrl: 'http://cdn.test' } }, defaultDisk: 'default' },
        imageGenerators: [sharpImageGenerator(), pdfImageGenerator()],
        models: {
          Doc: {
            collections: {
              files: collection()
                .withResponsiveImages()
                .conversions({ thumb: conversion().width(80).format('jpeg').nonQueued() }),
            },
          },
        },
      })

      const record = await media
        .for('Doc', 'd1')
        .add({ buffer: makeMinimalPdf(), fileName: 'doc.pdf' })
        .toCollection('files')

      const updated = await media.repository.findById(record.id)
      expect(updated?.mimeType).toBe('application/pdf')
      expect(updated?.generatedConversions['thumb']).toBe(true)
      const entry = updated?.responsiveImages['original'] as { files: unknown[] }
      expect(entry.files.length).toBeGreaterThan(0)

      const conversionFiles = await readdir(join(root, record.id, 'conversions'))
      expect(conversionFiles).toContain('doc-thumb.jpeg')
      const responsiveFiles = await readdir(join(root, record.id, 'responsive'))
      expect(responsiveFiles.some((f) => /___original_\d+_\d+\./.test(f))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
```

**Known watchpoint:** `responsiveFileName` derives the variant extension from the ORIGINAL file name when `format` is null — so `doc.pdf`'s original-responsive variants will be named `doc___original_{w}_{h}.pdf` while containing raster bytes. Assert what the code actually does (the regex above deliberately doesn't pin the extension), record the observed name in your report, and flag it as a review point — do NOT silently change engine naming in this task.

- [ ] **Step 2: Write the gated video integration test** in `packages/video/test/integration.test.ts` — same shape: lavfi-generated mp4 fixture (copy the beforeAll from Task 3 Step 5), collection `videos` with `poster: conversion().width(48).format('jpeg').nonQueued()` plus `.withResponsiveImages()`, assert `mimeType` is `video/mp4`, `generatedConversions.poster` true, original responsive entry non-empty, conversion file `clip-poster.jpeg` on disk (upload fileName `clip.mp4`). Gate the whole describe on `await ffmpegAvailable()`.

- [ ] **Step 3: Run both packages** (`pnpm --filter @node-media-library/pdf test`, `pnpm --filter @node-media-library/video test`) — locally these integration suites SKIP; the run must still exit green.

- [ ] **Step 4: Update `packages/core/README.md`**: in (or near) the conversions/responsive sections, add an "Other file types (PDF, video)" subsection: generators are appended explicitly via `imageGenerators`, pdf/video packages + their system binaries, `pdfPageNumber`/`videoFrameAtSecond` conversion options, files with no supporting generator skip conversions silently (attachment-only media works).

- [ ] **Step 5: Full verification**: `pnpm -r test` (expect: core/prisma/bullmq as before; pdf + video pure tests pass, gated suites skip) and `pnpm -r typecheck` → clean.

- [ ] **Step 6: Commit**:

```bash
git add packages/pdf packages/video packages/core/README.md
git commit -m "feat(pdf,video): end-to-end pipeline integration tests and generator docs"
```

---

## Self-review notes (done at planning time)

- Spec §9 coverage: generator interface `supports`/`toImage` ✓ (already existed; `toSourceImage` added T1), pdf/video packages ✓ (T2/T3), registration wording updated to explicit config ✓ (T1), "no supporting generator → skip silently" already core behavior, documented in README ✓ (T4). Spec §14 "pdf/video tests gate on binary availability" ✓ (T2/T3 `describe.runIf`). Plan-4 prerequisite (rasterize before responsive) ✓ (T1, exercised end-to-end in T4).
- Known honest limitation, surface in final summary: this dev machine has neither binary, so gated suites skip locally — pure tests + typecheck are the local gate; recommend `brew install poppler ffmpeg` to exercise the real paths.
- Deliberate YAGNI: `toImage` stays Buffer-input (temp files inside generators) — deviation from the old `Buffer | { path }` memory note, documented under Design decisions.
- Watchpoint carried to review: responsive variant file extension for non-image originals (`doc.pdf` → `...___original_w_h.pdf` containing raster bytes) — T4 Step 1 instructs asserting actual behavior and flagging, not silently patching.
- Type consistency: `PdfGeneratorOptions`/`VideoGeneratorOptions`, `buildPdftoppmArgs(page, dpi, pdfPath, outPrefix)`, `buildFfmpegFrameArgs(atSecond, videoPath, outPath)`, `pdftoppmAvailable`/`ffmpegAvailable`, `makeMinimalPdf` used identically across their tasks' src, tests, and index exports.
