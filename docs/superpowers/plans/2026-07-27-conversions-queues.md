# node-media-library Conversions + Queues Implementation Plan (Plan 3 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make conversions real: sharp-backed image derivation with per-media manipulation overrides, `generatedConversions` tracking with graceful URL fallback, a pluggable queue (sync default, in-process defer, BullMQ package), and a programmatic `regenerate`.

**Architecture:** Spec §8 + §12 of `docs/superpowers/specs/2026-07-26-node-media-library-design.md`. The engine is core-internal (`performConversions`) reachable two ways: inline (nonQueued conversions + syncDriver) and via `QueueDriver.enqueue` with payload `{ mediaId, conversionNames }` only — workers reload record + config, so jobs survive definition changes. `@node-media-library/bullmq` is a thin driver package.

**Tech Stack:** sharp ^0.35.3 (new core dependency), BullMQ ^5 (peer of the new package), vitest, existing core/prisma packages (core 98, prisma 25 tests green at ac7f6f3).

## Global Constraints

- Node >= 20, TypeScript strict ESM, `.js` relative imports. Commit after every task with the given message.
- `sharp` becomes a **dependency of core** (`"sharp": "^0.35.3"`) — the only new core runtime dep this plan may add. BullMQ appears ONLY in `packages/bullmq` as peer `"bullmq": "^5"` (+ devDep for tests).
- Queue job payload is EXACTLY `{ mediaId: string; conversionNames: string[] }` (spec §8) — no definitions, no records in the payload.
- `MediaEventMap` stays an **interface**; this plan adds `conversion:started` / `conversion:completed` / `conversion:failed` members to it directly in `packages/core/src/events.ts`.
- Derived files: `{conversionsPath(media)}/{fileNameSansExt}-{conversionName}.{ext}` where ext = `def.format ?? original extension`; written to `conversionsDisk ?? disk` (spec §8). One shared naming helper — engine and URL generator must not duplicate the formula.
- URL semantics (spec §8): `url(media, name)` returns the conversion URL only when `generatedConversions[name] === true`, else falls back to the original file's URL. Same for signed URLs.
- Failed conversions emit `conversion:failed` and leave `generatedConversions[name]` falsy; retry policy is the driver's concern (spec §8).
- BullMQ tests require Redis: gate on `process.env.REDIS_URL` with `describe.skipIf`, printing an explicit skip note. The sync/defer drivers are covered by a queue-driver contract suite that always runs.
- Run the full root suite (`pnpm test`) + typecheck before every commit; prisma package must stay green (it consumes core).

---

### Task 1: Extend the conversion definition surface

**Files:**
- Modify: `packages/core/src/definitions/conversion.ts`
- Test: `packages/core/test/definitions.test.ts` (add one `it`)

**Interfaces:**
- Produces (added to `ConversionDefinition`, all with builder methods returning `this`):
```ts
position: string | null          // sharp position/gravity incl. 'attention', 'entropy'; default null
sharpen: boolean                 // default false
blur: number | null              // sigma; default null
greyscale: boolean               // default false
autoOrient: boolean              // default TRUE (EXIF rotation)
pdfPageNumber: number            // default 1 (consumed in Plan 5)
videoFrameAtSecond: number       // default 0 (consumed in Plan 5)
```
Builder methods: `position(p: string)`, `sharpen()`, `blur(sigma: number)`, `greyscale()`, `autoOrient(on = true)`, `keepOriginalFormat()` (sets `format = null`), `pdfPageNumber(n: number)`, `videoFrameAtSecond(s: number)`.

- [ ] **Step 1: Write failing test** — add to `packages/core/test/definitions.test.ts`:
```ts
it('extended conversion surface: effects, autoOrient default, generator hints', () => {
  const def = conversion().width(100).position('attention').sharpen().blur(3)
    .greyscale().autoOrient(false).pdfPageNumber(2).videoFrameAtSecond(5).toDefinition()
  expect(def).toMatchObject({ position: 'attention', sharpen: true, blur: 3, greyscale: true, autoOrient: false, pdfPageNumber: 2, videoFrameAtSecond: 5 })
  expect(conversion().toDefinition().autoOrient).toBe(true)
  expect(conversion().format('webp').keepOriginalFormat().toDefinition().format).toBeNull()
})
```
- [ ] **Step 2: Run to verify fail** — `pnpm --filter @node-media-library/core test` → FAIL.
- [ ] **Step 3: Implement** the new fields/methods with the listed defaults.
- [ ] **Step 4: Run to verify pass** — core suite + typecheck green; root `pnpm test` green.
- [ ] **Step 5: Commit** — `git commit -am "feat(core): extend conversion definition surface"`

---

### Task 2: Queue driver interface, sync/defer drivers, conversion events, driver contract suite

**Files:**
- Create: `packages/core/src/queue.ts`, `packages/core/src/testing/queue-contract.ts`
- Modify: `packages/core/src/events.ts`, `packages/core/src/testing/index.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/queue.test.ts`

**Interfaces:**
- Produces:
```ts
// queue.ts
export interface ConversionJob { mediaId: string; conversionNames: string[] }
export type ConversionProcessor = (job: ConversionJob) => Promise<void>
export interface QueueDriver {
  enqueue(job: ConversionJob): Promise<void>
  registerProcessor(fn: ConversionProcessor): void   // exactly one; later calls replace
  close(): Promise<void>                             // idempotent
}
export function syncDriver(): QueueDriver    // enqueue awaits the processor inline; processor errors PROPAGATE to enqueue's caller
export function deferDriver(): QueueDriver   // enqueue resolves immediately; processor runs via setImmediate; errors are caught + console.error'd (the engine emits conversion:failed itself)
// events.ts additions to MediaEventMap (payloads):
'conversion:started':   { media: MediaRecord; conversion: string }
'conversion:completed': { media: MediaRecord; conversion: string }
'conversion:failed':    { media: MediaRecord; conversion: string; error: unknown }
// testing/queue-contract.ts
export function runQueueDriverContract(name: string, factory: () => Promise<QueueDriver>, opts?: { waitForAsync?: () => Promise<void> }): void
```
Contract semantics (one `it` each): **registerProcessor must be called before enqueue; enqueuing without a processor rejects with `MediaLibraryError('no processor registered')`**; processor receives the exact job payload; multiple jobs all get processed (order asserted for sync only); `close()` twice resolves; after `close()`, `enqueue` rejects. `opts.waitForAsync` lets async drivers flush (defer: `await new Promise(setImmediate)`; bullmq supplies its own).

- [ ] **Step 1: Write the contract suite + test file** — `queue-contract.ts` implements the semantics above (~6 its, each concrete: capture arrays, exact payload equality, rejection assertions). `packages/core/test/queue.test.ts`:
```ts
import { runQueueDriverContract } from '../src/testing/queue-contract.js'
import { syncDriver, deferDriver } from '../src/queue.js'
runQueueDriverContract('syncDriver', async () => syncDriver())
runQueueDriverContract('deferDriver', async () => deferDriver(), { waitForAsync: () => new Promise((r) => setImmediate(r)) })
it('syncDriver propagates processor errors to enqueue', async () => {
  const d = syncDriver(); d.registerProcessor(async () => { throw new Error('boom') })
  await expect(d.enqueue({ mediaId: 'm', conversionNames: ['t'] })).rejects.toThrow('boom')
})
it('deferDriver swallows processor errors after logging', async () => {
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
  const d = deferDriver(); d.registerProcessor(async () => { throw new Error('boom') })
  await d.enqueue({ mediaId: 'm', conversionNames: ['t'] })
  await new Promise((r) => setImmediate(r))
  expect(warn).toHaveBeenCalled()
})
```
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** `queue.ts` (two small factory functions with closed-over state: `processor`, `closed`), add the three events to `MediaEventMap`, export from `index.ts` + `testing/index.ts`.
- [ ] **Step 4: Run to verify pass** — full root suite + typecheck green.
- [ ] **Step 5: Commit** — `git commit -am "feat(core): queue driver interface with sync and defer drivers"`

---

### Task 3: Sharp image generator + conversion engine

**Files:**
- Create: `packages/core/src/conversions/naming.ts`, `packages/core/src/conversions/image-generator.ts`, `packages/core/src/conversions/engine.ts`
- Modify: `packages/core/package.json` (add `"sharp": "^0.35.3"`), `packages/core/src/config.ts` + `packages/core/src/library.ts` (config keys `queue?: QueueDriver` default `syncDriver()`, `imageGenerators?: ImageGenerator[]` default `[sharpImageGenerator()]`; library exposes them internally and calls `queue.registerProcessor` in the constructor wiring jobs to the engine), `packages/core/src/index.ts`
- Test: `packages/core/test/conversions.test.ts`

**Interfaces:**
- Consumes: `ConversionDefinition` (Task 1), `QueueDriver`/events (Task 2), storage/pathGenerator/repository internals (Plan 1).
- Produces:
```ts
// naming.ts
export function conversionFileName(originalFileName: string, conversionName: string, format: string | null): string
// 'photo.jpg','thumb',null → 'photo-thumb.jpg'; 'photo.jpg','web','webp' → 'photo-web.webp'; extensionless 'file','t',null → 'file-t'
export function conversionKey(media: MediaRecord, pathGen: PathGenerator, def: ConversionDefinition, name: string): string
// = `${pathGen.conversionsPath(media)}/${conversionFileName(media.fileName, name, def.format)}`

// image-generator.ts
export interface ImageGenerator {
  supports(mimeType: string | null): boolean
  toImage(input: Buffer, def: ConversionDefinition): Promise<Buffer>
}
export function sharpImageGenerator(): ImageGenerator
// supports: image/jpeg, image/png, image/webp, image/avif, image/gif, image/svg+xml
// toImage pipeline: sharp(input) → autoOrient when def.autoOrient → resize({ width, height, fit: def.fit ?? 'cover', position: def.position ?? undefined }) only when width||height set → greyscale when def.greyscale → blur(def.blur) when set → sharpen() when def.sharpen → format: toFormat(def.format, { quality: def.quality ?? undefined }) when def.format set; else when only def.quality set, toFormat(<original format from sharp metadata>, { quality }) → toBuffer()

// engine.ts
export interface RegenerateOptions { modelType?: string; ids?: string[]; only?: string[]; onlyMissing?: boolean }
export class ConversionEngine {
  constructor(deps: { repository: MediaRepository; storage: ResolvedStorage; pathGenerator: PathGenerator; events: TypedEmitter<MediaEventMap>; generators: ImageGenerator[]; definitionsFor(modelType: string, collection: string): Record<string, ConversionDefinition> })
  applicable(media: MediaRecord): Record<string, ConversionDefinition>  // definitionsFor(modelType, collectionName) filtered by performOnCollections; per-media manipulations (JsonObject per conversion name) shallow-merged over the matching def
  async perform(mediaId: string, names?: string[]): Promise<void>       // load record (missing → return silently: job outlived the media); pick generator by mime (none → return); read original from its disk; for each applicable [name, def] (∩ names when given): emit conversion:started → toImage → put to (conversionsDisk ?? disk) at conversionKey → repository.update merging { generatedConversions: { ...existing, [name]: true } } → emit conversion:completed; on per-conversion error: emit conversion:failed with the error, continue to the next conversion, and rethrow at the end ONLY if every requested conversion failed
}
```
`MediaLibrary` wiring: constructor creates the engine with `definitionsFor: (t, c) => this.getCollectionDefinition(t, c).conversions`, calls `queue.registerProcessor((job) => engine.perform(job.mediaId, job.conversionNames))`, and exposes `performConversions(mediaId, names?)` (thin passthrough, used by FileAdder for nonQueued + by tests).

- [ ] **Step 1: Write failing tests** — `packages/core/test/conversions.test.ts`. Fixture: temp fs storage, `InMemoryMediaRepository`, models `{ Post: { collections: { images: collection().conversions({ thumb: conversion().width(8).height(8).nonQueued(), web: conversion().width(10).format('webp').nonQueued() }) } } }`, a real 32x32 PNG built inline with sharp (`await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 10, b: 10 } } }).png().toBuffer()`). 6 its, write each fully; exemplar:
```ts
it('conversionFileName formula', () => {
  expect(conversionFileName('photo.jpg', 'thumb', null)).toBe('photo-thumb.jpg')
  expect(conversionFileName('photo.jpg', 'web', 'webp')).toBe('photo-web.webp')
  expect(conversionFileName('file', 't', null)).toBe('file-t')
})
```
Remaining five, exact outcomes: `perform generates files, marks generatedConversions, emits started+completed` (add media via the pipeline with the two nonQueued defs — assert both derived files exist at their conversionKey paths, sharp metadata of the thumb file reports width 8, the record's generatedConversions equals `{ thumb: true, web: true }`, captured events contain started+completed per conversion name); `format switch produces webp` (metadata format === 'webp' for the web file); `per-media manipulations override` (repository.update the record with `manipulations: { thumb: { width: 4 } }`, `performConversions(id, ['thumb'])` again → thumb metadata width 4); `unsupported mime skips silently` (add a text buffer to an ad-hoc collection, perform → resolves, generatedConversions stays `{}`, no conversion events); `failed conversion emits failed and does not mark generated` (overwrite the stored original file with garbage bytes via the disk, perform(['thumb']) → conversion:failed captured with an error, generatedConversions lacks 'thumb', and perform rejects since ALL requested conversions failed).
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** naming.ts, image-generator.ts, engine.ts; wire config/library; `pnpm install` for sharp.
- [ ] **Step 4: Run to verify pass** — full root suite + typecheck green (prisma suite must still pass — the new `queue`/`imageGenerators` config keys must be optional).
- [ ] **Step 5: Commit** — `git commit -am "feat(core): sharp conversion engine with generated-conversions tracking"`

---

### Task 4: FileAdder dispatch + manipulations update

**Files:**
- Modify: `packages/core/src/pipeline/file-adder.ts` (post-`media:added` dispatch), `packages/core/src/library.ts` (`updateManipulations`)
- Test: `packages/core/test/conversion-dispatch.test.ts`

**Interfaces:**
- Consumes: engine + queue (Task 3), FileAdder internals (Plan 1).
- Produces:
```ts
// FileAdder.toCollection, after emitting media:added:
//   const defs = engine.applicable(record)                 — already collection-filtered
//   nonQueued names (def.queued === false) → await library.performConversions(record.id, nonQueuedNames) inline (errors PROPAGATE)
//   queued names (def.queued === true) → await queue.enqueue({ mediaId: record.id, conversionNames: queuedNames }) (syncDriver runs them here; enqueue rejection propagates)
//   both lists empty → no calls at all
// MediaLibrary addition:
async updateManipulations(mediaId: string, manipulations: Record<string, JsonObject>): Promise<MediaRecord>
// repository.update({ manipulations }) then queue.enqueue({ mediaId, conversionNames: Object.keys(manipulations) }) — spec §8 "changing it triggers regeneration"; returns the updated record
```

- [ ] **Step 1: Write failing tests** — `packages/core/test/conversion-dispatch.test.ts`, fixture like Task 3 but with `thumb: conversion().width(8)` (queued, default) and `badge: conversion().width(4).nonQueued()`; one library instance with the default syncDriver and one with `deferDriver()`. 4 its, exact outcomes: `add() with syncDriver produces both derived files before toCollection resolves`; `add() with deferDriver: nonQueued badge file exists immediately after toCollection, queued thumb only after a setImmediate flush`; `updateManipulations persists and regenerates` (add → thumb metadata width 8; `updateManipulations(id, { thumb: { width: 6 } })` → after flush, thumb metadata width 6 and record.manipulations persisted); `unsupported file adds fine and dispatches nothing` (text buffer into the same collection → toCollection resolves, conversions directory absent, no conversion events).
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** dispatch + `updateManipulations`.
- [ ] **Step 4: Run to verify pass** — full root suite + typecheck (Plan 1's file-adder tests must stay green — dispatch must no-op cleanly for collections with no conversions).
- [ ] **Step 5: Commit** — `git commit -am "feat(core): conversion dispatch from upload pipeline and manipulations updates"`

---

### Task 5: Conversion URLs + regenerate

**Files:**
- Modify: `packages/core/src/storage/url-generator.ts` (real `conversionName` handling), `packages/core/src/library.ts` (`regenerate` + wiring the url-generator's new dep), `packages/core/src/handle.ts` (only if availableUrl/firstUrl need touch-ups — they already consult `generatedConversions`)
- Test: `packages/core/test/conversion-urls.test.ts`

**Interfaces:**
- Consumes: `conversionKey`/`conversionFileName` (Task 3), engine, `RegenerateOptions` (Task 3).
- Produces:
```ts
// DefaultUrlGenerator gains an optional ctor dep:
//   { conversionFileNameFor?: (media: MediaRecord, name: string) => string | null }
// MediaLibrary supplies it as: (media, name) => { const def = engine.applicable(media)[name]; return def ? conversionFileName(media.fileName, name, def.format) : null }
// url/signedUrl with conversionName:
//   generatedConversions[name] === true AND conversionFileNameFor returns a filename
//     → URL for `${pathGen.conversionsPath(media)}/${fileName}` on (conversionsDisk ?? disk)
//   else → original file's URL (graceful fallback)
// MediaLibrary addition:
async regenerate(opts?: RegenerateOptions): Promise<{ enqueued: number }>
// opts.ids given → those records via findById (skip missing); else iterateAll({ modelType: opts.modelType })
// per record: names = Object.keys(engine.applicable(record)); ∩ opts.only when given; minus names already true in generatedConversions when opts.onlyMissing
// names non-empty → queue.enqueue({ mediaId: record.id, conversionNames: names }); returns count of jobs enqueued
```

- [ ] **Step 1: Write failing tests** — `packages/core/test/conversion-urls.test.ts`, fs storage with `baseUrl: 'http://localhost:9000/media'`, syncDriver, model with `thumb: conversion().width(8)`. 5 its, exact outcomes: `firstUrl(collection, 'thumb') returns the conversion URL once generated` (string starts with the baseUrl and ends `/conversions/<base>-thumb.png`); `url falls back to original for an unknown/ungenerated name` (asking for 'nope' equals the original URL); `availableUrl picks the first generated conversion` (['nope','thumb'] → thumb URL); `regenerate({ onlyMissing: true })` (all generated → `{ enqueued: 0 }`; after `repository.update(id, { generatedConversions: {} })` and deleting the derived file → `{ enqueued: 1 }` and the file exists again); `regenerate({ ids: [id], only: ['thumb'] })` targets exactly one record (returns `{ enqueued: 1 }`).
- [ ] **Step 2: Run to verify fail** → FAIL.
- [ ] **Step 3: Implement** the url-generator conversion branch + `regenerate`.
- [ ] **Step 4: Run to verify pass** — full root suite + typecheck (Plan 1's generators.test.ts must stay green — the new ctor dep must be optional with unchanged default behavior).
- [ ] **Step 5: Commit** — `git commit -am "feat(core): conversion urls with graceful fallback and regenerate"`

---

### Task 6: `@node-media-library/bullmq` package + exports audit

**Files:**
- Create: `packages/bullmq/package.json`, `packages/bullmq/tsconfig.json`, `packages/bullmq/vitest.config.ts`, `packages/bullmq/src/index.ts`, `packages/bullmq/src/driver.ts`, `packages/bullmq/README.md`
- Modify: `packages/core/src/index.ts` + `packages/core/test/exports.test.ts` (extend), `packages/core/src/testing/queue-contract.ts` (add `skipNoProcessorRule` opt)
- Test: `packages/bullmq/test/driver.test.ts`

**Interfaces:**
- Produces:
```ts
export interface BullmqDriverOptions {
  connection: unknown            // ioredis-compatible options or instance; passed through to BullMQ
  queueName?: string             // default 'media-conversions'
  workerConcurrency?: number     // default 2
}
export function bullmqDriver(opts: BullmqDriverOptions): QueueDriver
// enqueue → Queue.add('convert', job) (Queue lazily constructed on first use)
// registerProcessor → lazily creates a Worker(queueName, (j) => fn(j.data), { connection, concurrency })
// close() → await worker?.close(); await queue?.close(); idempotent
```
Package: runtime dep `@node-media-library/core: workspace:*`; peer `"bullmq": "^5"` (required, not optional — the package is pointless without it); devDeps `bullmq@^5.81.2`, `typescript@^5.5.0`, `vitest@^2.0.0`. `driver.ts` imports bullmq statically (that IS this package's purpose). Contract-suite amendment (this task): `runQueueDriverContract` gains `opts.skipNoProcessorRule?: boolean` — a broker-backed queue legitimately accepts jobs with no local processor, so that one `it` is skipped for bullmq.

- [ ] **Step 1: Scaffold the package** (mirror packages/bullmq shapes off packages/prisma minus prisma config/globalSetup) with placeholder index; `pnpm install`; root suite still green.
- [ ] **Step 2: Write tests** — `packages/bullmq/test/driver.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { runQueueDriverContract } from '@node-media-library/core/testing'
import { bullmqDriver } from '../src/driver.js'
const hasRedis = !!process.env.REDIS_URL
if (!hasRedis) console.warn('[bullmq tests] REDIS_URL not set — driver contract suite skipped')
describe.skipIf(!hasRedis)('bullmqDriver contract (requires REDIS_URL)', () => {
  runQueueDriverContract('bullmqDriver', async () => bullmqDriver({ connection: { url: process.env.REDIS_URL! }, queueName: `mlq-${crypto.randomUUID()}` }), { waitForAsync: () => new Promise((r) => setTimeout(r, 500)), skipNoProcessorRule: true })
})
it('constructs without touching redis', () => {
  expect(typeof bullmqDriver({ connection: { host: 'localhost' } }).enqueue).toBe('function')
})
```
- [ ] **Step 3: Implement `driver.ts`** + the contract-suite `skipNoProcessorRule` opt. Verify: without REDIS_URL the suite passes with the printed skip note; if a local Redis is reachable, run once with `REDIS_URL=redis://localhost:6379` and record the outcome in the report (otherwise record that it ran skipped).
- [ ] **Step 4: Exports audit** — extend `packages/core/test/exports.test.ts` with the new core names (`syncDriver`, `deferDriver`, `QueueDriver`, `ConversionJob`, `ConversionProcessor`, `ImageGenerator`, `sharpImageGenerator`, `conversionFileName`, `RegenerateOptions`, and `runQueueDriverContract` from `../src/testing/index.js`); add a small exports `it` in the bullmq package for `bullmqDriver`/`BullmqDriverOptions`. Write `packages/bullmq/README.md` — 30-45 lines (`wc -l` verified), "Once published:" framing, wiring snippet (`queue: bullmqDriver({ connection })` inside `createMediaLibrary`), a worker-process snippet (construct the same MediaLibrary from the same config in a separate process — registration happens in the constructor — and keep the process alive), REDIS_URL test note. Every snippet API-accurate against the real exports.
- [ ] **Step 5: Run full root suite + typecheck; commit** — `git commit -am "feat(bullmq): bullmq queue driver package"`

---

## Self-Review (performed at plan-writing time)

1. **Spec §8 coverage:** fluent-surface completion → Task 1 (pdf/video hints stored now, consumed in Plan 5); queued-by-default + per-conversion override + dispatch split → Tasks 2/4; `generatedConversions` tracking + graceful URL fallback → Tasks 3/5; derived-file naming/location + conversionsDisk → Task 3 (single shared helper, consumed by Task 5); per-media manipulations merge + change-triggers-regeneration → Tasks 3/4; queue driver interface + payload shape + sync/defer + BullMQ package → Tasks 2/6; programmatic regenerate → Task 5; `conversion:*` events (spec §12) → Task 2. The regenerate CLI stays in Plan 6 (spec §13); responsive images stay Plan 4 (`withResponsiveImages` remains stored-only).
2. **Placeholder scan:** Tasks 3–5 use the established one-full-exemplar + exact-outcomes convention; Task 6 embeds the real gating code. No TBDs.
3. **Type consistency:** `ConversionJob`/`QueueDriver`/`ConversionProcessor` (Task 2) consumed in Tasks 3/4/5/6; `conversionFileName`/`conversionKey` (Task 3) consumed in Task 5; `RegenerateOptions` defined Task 3, implemented Task 5; `performConversions(mediaId, names?)` consistent across Tasks 3/4; the Task 6 amendment to the Task 2 contract file (`skipNoProcessorRule`) is called out explicitly as an amendment.
