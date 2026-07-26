# node-media-library Core Foundation Implementation Plan (Plan 1 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `core` package foundation: monorepo, types, definition builders, config registry, repository contract + in-memory implementation, FlyDrive storage with env-driven defaults, and the full ingestion/retrieval/lifecycle pipeline (no conversions yet — that is Plan 3).

**Architecture:** ORM-agnostic core per spec `docs/superpowers/specs/2026-07-26-node-media-library-design.md` §3–§7, §10. Everything DB-specific hides behind `MediaRepository`; everything storage-specific behind FlyDrive `Disk` + `PathGenerator`/`UrlGenerator`. Fluent handle API: `media.for(type, id).add(src)...toCollection(name)`.

**Tech Stack:** TypeScript (strict, ESM), pnpm workspaces, vitest, `flydrive` v1.3 (v2 requires Node >=24; ruled 2026-07-26: keep Node >=20 floor), `file-type`.

## Global Constraints

- Node >= 20, `"type": "module"` everywhere, TypeScript `strict: true`.
- Working npm names `@node-media-library/core` etc. — final scope is a publish-time rename (spec §2).
- Core dependencies for this plan: `flydrive`, `file-type` ONLY (sharp arrives in Plan 3). No ORM, HTTP-framework, or queue-infra deps in core (spec §3).
- v1 ingestion is buffer-based (default `maxFileSize` 10 MiB = `10 * 1024 * 1024` makes this safe); streaming ingestion is a later optimization.
- Default extension blocklist: `['php', 'phtml', 'phar', 'htaccess']`, checked against EVERY dot-segment of the filename (spec §7).
- Visibility private by default; production-with-fs-driver warning must NOT name raw env var names (spec §10).
- Media `id` and `uuid` are both generated with `crypto.randomUUID()` in core, never by the DB.
- Commit after every task with the message given in its final step.

---

### Task 1: Monorepo scaffold + core package skeleton

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Produces: workspace layout every later task assumes; test command `pnpm --filter @node-media-library/core test`.

- [ ] **Step 1: Create workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

Root `package.json`:
```json
{
  "name": "node-media-library-monorepo",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": { "test": "pnpm -r test", "typecheck": "pnpm -r typecheck" }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "declaration": true, "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true, "noUncheckedIndexedAccess": true
  }
}
```

`.gitignore`: `node_modules/`, `dist/`, `storage/`, `*.tsbuildinfo`, `.DS_Store`

`packages/core/package.json`:
```json
{
  "name": "@node-media-library/core",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts", "./testing": "./src/testing/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "flydrive": "^1.3.0", "file-type": "^19.0.0" },
  "devDependencies": { "typescript": "^5.5.0", "vitest": "^2.0.0" }
}
```

`packages/core/tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }`

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
```

`packages/core/src/index.ts`: `export const VERSION = '0.0.0'`

- [ ] **Step 2: Write smoke test** — `packages/core/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/index.js'
describe('smoke', () => { it('imports the package', () => expect(VERSION).toBe('0.0.0')) })
```

- [ ] **Step 3: Install and run**

Run: `pnpm install && pnpm --filter @node-media-library/core test`
Expected: 1 test PASS. Also run `pnpm --filter @node-media-library/core typecheck` — clean. (If `flydrive`/`file-type` versions 404, check latest with `npm view flydrive version` and adjust carets.)

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "chore: scaffold pnpm monorepo with core package"
```

---

### Task 2: MediaRecord types + error taxonomy

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/errors.ts`
- Modify: `packages/core/src/index.ts` (re-export both)
- Test: `packages/core/test/errors.test.ts`

**Interfaces:**
- Produces (types.ts):
```ts
export type JsonObject = Record<string, unknown>
export interface MediaRecord {
  id: string; modelType: string; modelId: string; uuid: string
  collectionName: string; name: string; fileName: string
  mimeType: string | null; disk: string; conversionsDisk: string | null
  size: number
  manipulations: Record<string, JsonObject>
  customProperties: JsonObject
  generatedConversions: Record<string, boolean>
  responsiveImages: JsonObject
  orderColumn: number | null
  createdAt: Date; updatedAt: Date
}
export type NewMediaRecord = Omit<MediaRecord, 'createdAt' | 'updatedAt'>
export interface IncomingFile { fileName: string; mimeType: string | null; size: number }
```
- Produces (errors.ts): `MediaLibraryError` base (`code: string` property) and subclasses `FileTooLargeError` (`FILE_TOO_LARGE`), `DisallowedExtensionError` (`DISALLOWED_EXTENSION`), `UnacceptableFileError` (`UNACCEPTABLE_FILE`), `UnknownModelError` (`UNKNOWN_MODEL`), `ConversionFailedError` (`CONVERSION_FAILED`), `StorageError` (`STORAGE_ERROR`), `DownloadFailedError` (`DOWNLOAD_FAILED`). Each constructor takes `(message: string)`; base sets `this.name = new.target.name`.

- [ ] **Step 1: Write failing test** — `packages/core/test/errors.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { MediaLibraryError, FileTooLargeError, DisallowedExtensionError } from '../src/errors.js'
describe('errors', () => {
  it('subclasses carry codes and instanceof', () => {
    const e = new FileTooLargeError('too big')
    expect(e).toBeInstanceOf(MediaLibraryError)
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('FILE_TOO_LARGE')
    expect(e.name).toBe('FileTooLargeError')
  })
  it('extension error has its code', () => {
    expect(new DisallowedExtensionError('x').code).toBe('DISALLOWED_EXTENSION')
  })
})
```

- [ ] **Step 2: Run to verify fail** — `pnpm --filter @node-media-library/core test` → FAIL (module not found).

- [ ] **Step 3: Implement** — `errors.ts`:
```ts
export class MediaLibraryError extends Error {
  constructor(message: string, public readonly code: string = 'MEDIA_LIBRARY_ERROR') {
    super(message); this.name = new.target.name
  }
}
export class FileTooLargeError extends MediaLibraryError { constructor(m: string) { super(m, 'FILE_TOO_LARGE') } }
export class DisallowedExtensionError extends MediaLibraryError { constructor(m: string) { super(m, 'DISALLOWED_EXTENSION') } }
export class UnacceptableFileError extends MediaLibraryError { constructor(m: string) { super(m, 'UNACCEPTABLE_FILE') } }
export class UnknownModelError extends MediaLibraryError { constructor(m: string) { super(m, 'UNKNOWN_MODEL') } }
export class ConversionFailedError extends MediaLibraryError { constructor(m: string) { super(m, 'CONVERSION_FAILED') } }
export class StorageError extends MediaLibraryError { constructor(m: string) { super(m, 'STORAGE_ERROR') } }
export class DownloadFailedError extends MediaLibraryError { constructor(m: string) { super(m, 'DOWNLOAD_FAILED') } }
```
`types.ts` exactly as the Interfaces block above. Re-export both from `index.ts`.

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(core): media record types and error taxonomy"`

---

### Task 3: Typed event emitter

**Files:**
- Create: `packages/core/src/events.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/events.test.ts`

**Interfaces:**
- Consumes: `MediaRecord` from Task 2.
- Produces:
```ts
export interface MediaEventMap {
  'media:added': { media: MediaRecord }
  'media:deleting': { media: MediaRecord }
  'media:deleted': { media: MediaRecord }
  'collection:cleared': { modelType: string; modelId: string; collection: string }
}
export class TypedEmitter<T extends Record<string, unknown>> {
  on<K extends keyof T>(event: K, fn: (payload: T[K]) => void): () => void  // returns unsubscribe
  emit<K extends keyof T>(event: K, payload: T[K]): void
}
```
(Plan 3 extends `MediaEventMap` with conversion events via interface merging — keep it an `interface`.)

- [ ] **Step 1: Write failing test** — `packages/core/test/events.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { TypedEmitter } from '../src/events.js'
describe('TypedEmitter', () => {
  it('delivers payloads and unsubscribes', () => {
    const em = new TypedEmitter<{ ping: { n: number } }>()
    const seen: number[] = []
    const off = em.on('ping', (p) => seen.push(p.n))
    em.emit('ping', { n: 1 }); off(); em.emit('ping', { n: 2 })
    expect(seen).toEqual([1])
  })
  it('listener errors do not break emit', () => {
    const em = new TypedEmitter<{ ping: { n: number } }>()
    em.on('ping', () => { throw new Error('boom') })
    const seen: number[] = []
    em.on('ping', (p) => seen.push(p.n))
    em.emit('ping', { n: 3 })
    expect(seen).toEqual([3])
  })
})
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement** — Map of Sets; `emit` iterates a copy, wraps each listener in try/catch (swallow, `console.error`). ~20 lines.

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(core): typed event emitter"`

---

### Task 4: Collection & conversion definition builders

**Files:**
- Create: `packages/core/src/definitions/conversion.ts`, `packages/core/src/definitions/collection.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/definitions.test.ts`

**Interfaces:**
- Consumes: `IncomingFile` (Task 2).
- Produces:
```ts
// conversion.ts
export interface ConversionDefinition {
  width: number | null; height: number | null
  fit: 'cover' | 'contain' | 'fill' | 'inside' | 'outside' | null
  format: 'jpeg' | 'png' | 'webp' | 'avif' | null   // null = keep original format
  quality: number | null; queued: boolean            // default true
  performOnCollections: string[] | null              // null = all collections
  responsiveImages: boolean
}
export function conversion(): ConversionBuilder
// ConversionBuilder methods (each returns this): width(n), height(n), fit(f), format(f),
// quality(n), queued(), nonQueued(), performOnCollections(...names), withResponsiveImages()
// plus toDefinition(): ConversionDefinition

// collection.ts
export interface CollectionDefinition {
  singleFile: boolean; keepLatest: number | null
  acceptsMimeTypes: string[] | null                  // supports 'image/*' wildcards
  acceptsFile: ((file: IncomingFile) => boolean) | null
  disk: string | null; conversionsDisk: string | null
  public: boolean
  fallbackUrls: Record<string, string>               // key '' = original, else conversion name
  conversions: Record<string, ConversionDefinition>
  responsiveImages: boolean
}
export function collection(): CollectionBuilder
// CollectionBuilder methods (each returns this): singleFile(), onlyKeepLatest(n),
// acceptsMimeTypes(types), acceptsFile(fn), useDisk(name), storeConversionsOnDisk(name),
// public(), fallbackUrl(url, conversionName = ''), conversions(record<string, ConversionBuilder>),
// withResponsiveImages(), toDefinition(): CollectionDefinition
export const DEFAULT_COLLECTION: CollectionDefinition  // all-permissive: no rules, private, no conversions
export function matchesMime(pattern: string, mime: string): boolean  // 'image/*' matches 'image/png'; exact otherwise
```

- [ ] **Step 1: Write failing test** — `packages/core/test/definitions.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { collection, conversion, matchesMime, DEFAULT_COLLECTION } from '../src/index.js'
describe('definition builders', () => {
  it('collection builder produces plain serializable data', () => {
    const def = collection().singleFile().acceptsMimeTypes(['image/*'])
      .public().fallbackUrl('/img/default.png')
      .conversions({ thumb: conversion().width(368).height(232).fit('cover').nonQueued() })
      .toDefinition()
    expect(def.singleFile).toBe(true)
    expect(def.public).toBe(true)
    expect(def.fallbackUrls['']).toBe('/img/default.png')
    expect(def.conversions.thumb).toMatchObject({ width: 368, height: 232, fit: 'cover', queued: false })
    expect(JSON.parse(JSON.stringify({ ...def, acceptsFile: undefined }))).toBeTruthy()
  })
  it('onlyKeepLatest and singleFile are mutually exclusive', () => {
    expect(() => collection().singleFile().onlyKeepLatest(3)).toThrow()
  })
  it('conversion defaults: queued, keep-original format', () => {
    const def = conversion().width(100).toDefinition()
    expect(def.queued).toBe(true); expect(def.format).toBeNull()
  })
  it('matchesMime wildcard and exact', () => {
    expect(matchesMime('image/*', 'image/png')).toBe(true)
    expect(matchesMime('image/*', 'video/mp4')).toBe(false)
    expect(matchesMime('image/png', 'image/png')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement** — Builders hold a mutable definition object initialized to defaults and return `this` from each setter; `toDefinition()` returns the object. `collection().conversions(map)` calls `toDefinition()` on each value. `singleFile()`/`onlyKeepLatest(n)` each throw `new MediaLibraryError('singleFile and onlyKeepLatest are mutually exclusive')` if the other is already set. `matchesMime`: `pattern.endsWith('/*') ? mime.startsWith(pattern.slice(0, -1)) : pattern === mime`.

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(core): collection and conversion definition builders"`

---

### Task 5: MediaRepository interface, in-memory implementation, contract test suite

**Files:**
- Create: `packages/core/src/repository.ts`, `packages/core/src/repository/in-memory.ts`, `packages/core/src/testing/repository-contract.ts`, `packages/core/src/testing/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/in-memory-repository.test.ts`

**Interfaces:**
- Consumes: `MediaRecord`, `NewMediaRecord` (Task 2).
- Produces (spec §6, verbatim contract):
```ts
export interface MediaFilter { modelType?: string; collectionName?: string }
export interface MediaRepository {
  create(data: NewMediaRecord): Promise<MediaRecord>
  update(id: string, patch: Partial<Omit<MediaRecord, 'id' | 'createdAt'>>): Promise<MediaRecord>
  findById(id: string): Promise<MediaRecord | null>
  findByUuid(uuid: string): Promise<MediaRecord | null>
  findForModel(modelType: string, modelId: string, collection?: string): Promise<MediaRecord[]>
  delete(id: string): Promise<void>
  setOrder(ids: string[], startAt?: number): Promise<void>
  iterateAll(filter?: MediaFilter): AsyncIterable<MediaRecord>
  ownerExists(modelType: string, modelId: string): Promise<boolean>
}
export class InMemoryMediaRepository implements MediaRepository {
  constructor(opts?: { ownerExists?: (type: string, id: string) => boolean })
}
// testing/repository-contract.ts
export function runMediaRepositoryContract(name: string, factory: () => Promise<MediaRepository>): void
```
Contract semantics the suite must assert: `create` stamps `createdAt`/`updatedAt`; `update` bumps `updatedAt` and rejects unknown id; `findForModel` returns records sorted by `orderColumn` asc (nulls last) then `createdAt` asc, filtered by collection when given; `delete` is idempotent; `setOrder([idB, idA])` gives B `orderColumn` 1 (or `startAt`) and A 2; `iterateAll` honors filters.

- [ ] **Step 1: Write the contract suite** (this IS the failing test) — `repository-contract.ts` uses vitest `describe/it/expect/beforeEach` imported from `'vitest'`; helper `makeRecord(over?: Partial<NewMediaRecord>): NewMediaRecord` generating unique ids via `crypto.randomUUID()` with defaults (`modelType: 'User'`, `modelId: 'u1'`, `collectionName: 'default'`, `fileName: 'a.jpg'`, `name: 'a'`, `disk: 'default'`, `size: 1`, empty JSON fields, `orderColumn: null`, `mimeType: 'image/jpeg'`, `conversionsDisk: null`). Write one `it` per semantic listed above (8 its). Then `packages/core/test/in-memory-repository.test.ts`:
```ts
import { runMediaRepositoryContract } from '../src/testing/repository-contract.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
runMediaRepositoryContract('InMemoryMediaRepository', async () => new InMemoryMediaRepository())
```

- [ ] **Step 2: Run to verify fail** → FAIL (in-memory class missing).

- [ ] **Step 3: Implement `InMemoryMediaRepository`** — `Map<string, MediaRecord>`; `create` throws on duplicate id; `update` merges patch + `updatedAt: new Date()`; sorting comparator shared as exported `compareMediaOrder(a, b)`; `iterateAll` is an async generator over sorted values; `ownerExists` delegates to the ctor option (default `() => true`).

- [ ] **Step 4: Run to verify pass** → PASS (all contract its green).

- [ ] **Step 5: Commit** — `git commit -am "feat(core): repository contract, in-memory implementation, exported contract suite"`

---

### Task 6: Storage resolution (FlyDrive disks, env defaults, production warning)

**Files:**
- Create: `packages/core/src/storage/resolve.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/storage-resolve.test.ts`

**Interfaces:**
- Produces:
```ts
export type DiskConfig =
  | { driver: 'fs'; root: string; visibility?: 'public' | 'private'; baseUrl?: string }
  | { driver: 's3'; bucket: string; region?: string; endpoint?: string; visibility?: 'public' | 'private'; baseUrl?: string }
export interface StorageConfig { default?: string; prefix?: string; disks?: Record<string, DiskConfig> }
export interface ResolvedStorage {
  defaultDisk: string
  prefix: string
  disk(name?: string): Promise<Disk>          // flydrive Disk; lazy-creates, memoizes
  diskConfig(name?: string): DiskConfig
}
export function resolveStorage(config?: StorageConfig, env?: Record<string, string | undefined>): ResolvedStorage
```
Resolution rules (spec §10): explicit `config.disks` win untouched. Otherwise synthesize a disk named `default`: if `env.MEDIA_S3_BUCKET` is set → s3 disk from `MEDIA_S3_BUCKET`/`MEDIA_S3_REGION`/`MEDIA_S3_ENDPOINT`; else fs disk at `env.MEDIA_FS_ROOT ?? './storage/media'`. `prefix` = `config.prefix ?? env.MEDIA_PREFIX ?? ''`. Visibility defaults `'private'`. If `env.NODE_ENV === 'production'` and the default disk resolves to fs, `console.warn('[media-library] Media is stored on the local filesystem in production. Configure S3-compatible storage for durability.')` — concept only, no env var names. S3 driver loaded via dynamic `import('flydrive/drivers/s3')` inside `disk()` so `@aws-sdk/*` stays an optional peer; fs via `import('flydrive/drivers/fs')`.

- [ ] **Step 1: Verify FlyDrive import paths** — Read `node_modules/flydrive/package.json` `exports` and README to confirm `Disk` root export and driver subpaths (`flydrive/drivers/fs`, `flydrive/drivers/s3`) and the FSDriver constructor options (`location`, `visibility`, URL building options). Adjust the code in Step 4 to what is actually exported — the semantics above are fixed; only import specifiers/ctor option names may differ.

- [ ] **Step 2: Write failing test** — `packages/core/test/storage-resolve.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
import { resolveStorage } from '../src/storage/resolve.js'
afterEach(() => vi.restoreAllMocks())
describe('resolveStorage', () => {
  it('defaults to fs disk when no s3 env present', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ml-'))
    const s = resolveStorage(undefined, { MEDIA_FS_ROOT: root })
    expect(s.defaultDisk).toBe('default')
    expect(s.diskConfig()).toMatchObject({ driver: 'fs', root })
    const disk = await s.disk()
    await disk.put('probe.txt', 'hello')
    expect(await disk.get('probe.txt')).toBe('hello')
  })
  it('prefers s3 when bucket env present', () => {
    const s = resolveStorage(undefined, { MEDIA_S3_BUCKET: 'b', MEDIA_S3_REGION: 'us-east-1' })
    expect(s.diskConfig()).toMatchObject({ driver: 's3', bucket: 'b' })
  })
  it('explicit config wins over env', () => {
    const s = resolveStorage({ disks: { default: { driver: 'fs', root: '/x' } } }, { MEDIA_S3_BUCKET: 'b' })
    expect(s.diskConfig()).toMatchObject({ driver: 'fs', root: '/x' })
  })
  it('warns once in production on fs driver, without env var names', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    resolveStorage(undefined, { NODE_ENV: 'production' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).not.toMatch(/MEDIA_|AWS_/)
  })
  it('reads prefix from config then env', () => {
    expect(resolveStorage({ prefix: 'app' }, { MEDIA_PREFIX: 'ignored' }).prefix).toBe('app')
    expect(resolveStorage(undefined, { MEDIA_PREFIX: 'from-env' }).prefix).toBe('from-env')
  })
})
```

- [ ] **Step 3: Run to verify fail** → FAIL.

- [ ] **Step 4: Implement** per the resolution rules and verified import paths; memoize created `Disk` instances in a `Map`. `env` parameter defaults to `process.env`.

- [ ] **Step 5: Run to verify pass** → PASS.

- [ ] **Step 6: Commit** — `git commit -am "feat(core): flydrive storage resolution with env defaults and production warning"`

---

### Task 7: Path & URL generators

**Files:**
- Create: `packages/core/src/storage/path-generator.ts`, `packages/core/src/storage/url-generator.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/generators.test.ts`

**Interfaces:**
- Consumes: `MediaRecord` (Task 2), `ResolvedStorage` (Task 6).
- Produces (spec §10):
```ts
export interface PathGenerator {
  path(media: MediaRecord): string               // original file
  conversionsPath(media: MediaRecord): string    // directory for derived files
  responsivePath(media: MediaRecord): string
  directory(media: MediaRecord): string          // root dir for this media item (for delete)
}
export class DefaultPathGenerator implements PathGenerator { constructor(prefix?: string) }
// path:  `${prefix?prefix+'/':''}${media.id}/${media.fileName}`
// directory: `${prefix?prefix+'/':''}${media.id}`
// conversionsPath: directory + '/conversions'; responsivePath: directory + '/responsive'
export interface SignedUrlOptions { expiresIn?: string | number }
export interface UrlGenerator {
  url(media: MediaRecord, conversionName?: string): Promise<string>       // throws StorageError if disk cannot build public URLs
  signedUrl(media: MediaRecord, conversionName?: string, opts?: SignedUrlOptions): Promise<string>
}
export class DefaultUrlGenerator implements UrlGenerator {
  constructor(storage: ResolvedStorage, pathGen: PathGenerator, opts?: { versionUrls?: boolean; signedUrlExpiresIn?: string | number })
}
```
Behavior: `conversionName` is accepted but until Plan 3 only `''`/undefined (original) is used — pass-through to `pathGen.path(media)`; Plan 3 extends both generators for conversion paths. `versionUrls: true` appends `?v=${media.updatedAt.getTime()}`. `url()` delegates to flydrive `disk.getUrl(path)`; if the fs disk has a `baseUrl` DiskConfig, construct `${baseUrl}/${path}` directly when flydrive cannot. `signedUrl()` delegates to `disk.getSignedUrl(path, { expiresIn })`; for fs disks without signing support, fall back to `url()` (documented dev-mode behavior). Wrap driver errors in `StorageError`.

- [ ] **Step 1: Write failing test** — `packages/core/test/generators.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { DefaultPathGenerator } from '../src/storage/path-generator.js'
import { DefaultUrlGenerator } from '../src/storage/url-generator.js'
import { resolveStorage } from '../src/storage/resolve.js'
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
const media = { id: 'm1', fileName: 'photo.jpg', disk: 'default', updatedAt: new Date(1750000000000) } as any
describe('DefaultPathGenerator', () => {
  it('builds id-based paths with prefix', () => {
    const g = new DefaultPathGenerator('app')
    expect(g.path(media)).toBe('app/m1/photo.jpg')
    expect(g.directory(media)).toBe('app/m1')
    expect(g.conversionsPath(media)).toBe('app/m1/conversions')
  })
  it('omits empty prefix cleanly', () => {
    expect(new DefaultPathGenerator().path(media)).toBe('m1/photo.jpg')
  })
})
describe('DefaultUrlGenerator', () => {
  it('builds public url from fs baseUrl and appends version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ml-'))
    const storage = resolveStorage({ disks: { default: { driver: 'fs', root, baseUrl: 'http://localhost:9000/media' } } })
    const u = new DefaultUrlGenerator(storage, new DefaultPathGenerator(), { versionUrls: true })
    expect(await u.url(media)).toBe('http://localhost:9000/media/m1/photo.jpg?v=1750000000000')
  })
})
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement** both classes per the Interfaces block.

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(core): default path and url generators"`

---

### Task 8: Source normalization

**Files:**
- Create: `packages/core/src/pipeline/source.ts`
- Test: `packages/core/test/source.test.ts`

**Interfaces:**
- Consumes: `DownloadFailedError` (Task 2).
- Produces:
```ts
export type MediaSource =
  | string                                   // filesystem path (default semantics: MOVE)
  | Buffer | Readable | File | Blob
  | { base64: string; fileName?: string }
  | { url: string; allowedHosts?: string[] }
export interface NormalizedSource {
  buffer: Buffer
  originalFileName: string | null   // basename for paths/File; fileName for base64; url pathname basename for urls; null for Buffer/Readable
  sniffedMime: string | null        // via file-type magic bytes; null if unrecognized
  sourcePath: string | null         // set only for string-path sources (enables move semantics)
}
export async function normalizeSource(source: MediaSource): Promise<NormalizedSource>
```
Rules: string → `readFile`; Readable → collect chunks; File/Blob → `Buffer.from(await f.arrayBuffer())`, name from `File.name`; base64 → `Buffer.from(s, 'base64')` (throw `MediaLibraryError('invalid base64')` if round-trip length mismatch); url → global `fetch`, only `http:`/`https:` allowed, if `allowedHosts` given the URL host must be included (else `DownloadFailedError`), non-2xx → `DownloadFailedError`. Mime sniffed with `fileTypeFromBuffer` from `file-type`.

- [ ] **Step 1: Write failing test** — `packages/core/test/source.test.ts` (5 its): path source (write a real 1x1 PNG fixture buffer `Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')` to a temp file → expect `sniffedMime === 'image/png'`, `originalFileName` = basename, `sourcePath` set); Buffer source (same png buffer → mime sniffed, no fileName); base64 object (valid → decoded; `{ base64: '!!!' }` → throws); url source using `vi.stubGlobal('fetch', ...)` returning a 200 with the png bytes (→ works) and a 404 (→ `DownloadFailedError`); url with `allowedHosts: ['cdn.example.com']` and a different host → `DownloadFailedError` *without* fetch being called.

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement** per rules.

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(core): media source normalization with mime sniffing"`

---

### Task 9: Validation & filename sanitization

**Files:**
- Create: `packages/core/src/pipeline/validate.ts`, `packages/core/src/pipeline/sanitize.ts`
- Test: `packages/core/test/validate.test.ts`

**Interfaces:**
- Consumes: errors (Task 2), `CollectionDefinition`/`matchesMime` (Task 4), `IncomingFile` (Task 2).
- Produces:
```ts
export const DEFAULT_DISALLOWED_EXTENSIONS = ['php', 'phtml', 'phar', 'htaccess']
export interface ValidationContext {
  maxFileSize: number
  disallowedExtensions: string[]
  allowedExtensions: string[] | null   // when set, FINAL extension must be in it
  collection: CollectionDefinition
}
export function validateFile(file: IncomingFile, ctx: ValidationContext): void  // throws, returns nothing
export function sanitizeFileName(fileName: string): string
export type FileNameSanitizer = (fileName: string) => string
```
`validateFile` order: size > max → `FileTooLargeError`; every dot-segment after the first (lowercased) checked against `disallowedExtensions` → `DisallowedExtensionError` (so `x.php.jpg` fails); `allowedExtensions` checks only the final segment; `collection.acceptsMimeTypes` (some pattern must match, unknown mime `null` fails when list set) and `collection.acceptsFile?.(file)` → `UnacceptableFileError`. `sanitizeFileName`: strip directory components (`basename`), remove control chars and `<>:"/\|?*`, collapse whitespace to `-`, trim leading dots, fallback to `'file'` if empty.

- [ ] **Step 1: Write failing test** — `packages/core/test/validate.test.ts` (6 its): oversize throws `FileTooLargeError`; `evil.php` and `evil.php.jpg` both throw `DisallowedExtensionError`; `photo.jpg` with mime `image/jpeg` against `acceptsMimeTypes: ['image/*']` passes; mime `application/pdf` against same list throws `UnacceptableFileError`; `acceptsFile: (f) => f.size < 100` rejects a 200-byte file; `sanitizeFileName('../../etc/pass wd<x>.png')` returns a basename with no separators/brackets (assert `not.toMatch(/[\/\\<>]/)` and `toMatch(/\.png$/)`).

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement** per rules (use `DEFAULT_COLLECTION` in tests for rule-free cases).

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(core): file validation and filename sanitization"`

---

### Task 10: Config registry + `createMediaLibrary`

**Files:**
- Create: `packages/core/src/config.ts`, `packages/core/src/library.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/library.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
```ts
export interface MediaLibraryConfig {
  repository: MediaRepository
  storage?: StorageConfig
  models: Record<string, { collections?: Record<string, CollectionBuilder> }>
  maxFileSize?: number                       // default 10 * 1024 * 1024
  disallowedExtensions?: string[]            // default DEFAULT_DISALLOWED_EXTENSIONS
  allowedExtensions?: string[]
  versionUrls?: boolean                      // default false
  signedUrlExpiresIn?: string | number       // default '30 mins'
  fileNameSanitizer?: FileNameSanitizer
  pathGenerator?: PathGenerator
  urlGenerator?: UrlGenerator
}
export function createMediaLibrary(config: MediaLibraryConfig): MediaLibrary
export class MediaLibrary {
  readonly events: TypedEmitter<MediaEventMap>
  for(modelType: string, modelId: string | number): ModelMediaHandle  // UnknownModelError if type unregistered; number ids coerced to string
  getCollectionDefinition(modelType: string, collection: string): CollectionDefinition  // registered def, else DEFAULT_COLLECTION (ad-hoc)
  deleteMedia(mediaOrId: MediaRecord | string): Promise<void>
  clearFor(modelType: string, modelId: string | number, collection?: string): Promise<void>
  // internal accessors used by FileAdder/handle: repository, storage (ResolvedStorage), pathGenerator, urlGenerator, limits
}
```
Construction: builders in `models` are materialized to `CollectionDefinition`s once, up front. `storage` resolved via `resolveStorage`. Default generators wired with config prefix/options.

- [ ] **Step 1: Write failing test** — `packages/core/test/library.test.ts` (4 its): `for('Ghost', 1)` throws `UnknownModelError`; `for('User', 42)` returns a handle (models: `{ User: {} }`); `getCollectionDefinition('User', 'avatar')` returns the registered def (`singleFile` true in fixture) while `getCollectionDefinition('User', 'anything-else')` returns `DEFAULT_COLLECTION`; number `modelId` is stringified (handle exposes `modelId === '42'`). Use `InMemoryMediaRepository` and fs storage in a temp dir for every test in this file.

- [ ] **Step 2: Run to verify fail** → FAIL. (Stub `ModelMediaHandle` in `packages/core/src/handle.ts` with just `modelType`/`modelId` fields and `add()` throwing `new MediaLibraryError('not implemented')` — Task 11 fills it.)

- [ ] **Step 3: Implement** `config.ts` (defaults resolution → a frozen `ResolvedConfig`) and `library.ts`.

- [ ] **Step 4: Run to verify pass** → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(core): media library config registry and factory"`

---

### Task 11: FileAdder pipeline + collection rules

**Files:**
- Create: `packages/core/src/pipeline/file-adder.ts`
- Modify: `packages/core/src/library.ts` (implement `deleteMedia`), `packages/core/src/handle.ts` (`add()` returns real FileAdder)
- Test: `packages/core/test/file-adder.test.ts`

**Interfaces:**
- Consumes: `normalizeSource` (8), `validateFile`/`sanitizeFileName` (9), `MediaLibrary` internals (10), repository (5), storage (6), path generator (7).
- Produces:
```ts
export class FileAdder {
  usingName(name: string): this
  usingFileName(fileName: string): this
  withCustomProperties(props: JsonObject): this
  withManipulations(m: Record<string, JsonObject>): this
  preservingOriginal(): this                       // path sources: copy instead of move
  storingConversionsOnDisk(disk: string): this
  withResponsiveImages(): this                     // stored on record; engine arrives Plan 4
  toCollection(name?: string): Promise<MediaRecord>  // default 'default'
}
```
`toCollection` sequence (spec §7): normalize → derive `fileName` (explicit `usingFileName` > sanitized original > `'file'` + sniffed ext) and `name` (explicit > fileName sans extension) → validate (size from buffer length, sniffed mime; collection def from registry) → build `NewMediaRecord` (`id`/`uuid` = `crypto.randomUUID()`, `disk` = collection.disk ?? storage.defaultDisk, `mimeType` = sniffed, `orderColumn` = existing count + 1) → `disk.put(pathGen.path(record), buffer)` → `repository.create` → move semantics: if `sourcePath` set and not `preservingOriginal`, `fs.unlink(sourcePath)` → enforce collection rules: `singleFile` → delete every other record in (type, id, collection); `keepLatest: n` → delete oldest beyond n (sorted by `createdAt` desc, keep first n) → `events.emit('media:added', { media })` → return record. `MediaLibrary.deleteMedia`: load record (throw `MediaLibraryError('media not found')` if missing) → emit `media:deleting` → `disk.deleteAll(pathGen.directory(record))` → `repository.delete` → emit `media:deleted`.

- [ ] **Step 1: Write failing test** — `packages/core/test/file-adder.test.ts`. Shared fixture: temp-dir fs storage, `InMemoryMediaRepository`, models `{ User: { collections: { avatar: collection().singleFile().acceptsMimeTypes(['image/*']), gallery: collection().onlyKeepLatest(2) } } }`, PNG buffer from Task 8. 7 its — write each fully in the style of the first:
```ts
it('stores file on disk and creates record', async () => {
  const m = await media.for('User', 1).add(png).usingName('Avatar').toCollection('avatar')
  expect(m.mimeType).toBe('image/png')
  expect(m.collectionName).toBe('avatar')
  expect(existsSync(join(root, m.id, m.fileName))).toBe(true)
})
```
The remaining six, with exact inputs and expected outcomes: `add(png).usingFileName('x.php.png')` → rejects with `DisallowedExtensionError`; `add(Buffer.from('plain text'))` into `'avatar'` → rejects with `UnacceptableFileError` (mime null vs `image/*`); two adds into `'avatar'` → `getAll('avatar')` has length 1 and the first record's directory no longer exists on disk; three adds into `'gallery'` → length 2, the oldest record deleted; a temp-file path source is unlinked after add while a second temp file added with `.preservingOriginal()` still exists; an `events.on('media:added')` listener captures the returned record.

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement** `FileAdder` + `deleteMedia` per sequence.

- [ ] **Step 4: Run to verify pass** → run the WHOLE suite (`pnpm --filter @node-media-library/core test`) → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(core): file adder pipeline with collection rules and delete"`

---

### Task 12: Retrieval API on the handle

**Files:**
- Modify: `packages/core/src/handle.ts` (full implementation)
- Test: `packages/core/test/handle.test.ts`

**Interfaces:**
- Consumes: repository (5), url generator (7), `MediaLibrary` internals (10), FileAdder (11).
- Produces:
```ts
export type MediaQueryFilter = JsonObject | ((media: MediaRecord) => boolean)
export class ModelMediaHandle {
  readonly modelType: string; readonly modelId: string
  add(source: MediaSource): FileAdder
  getAll(collection?: string, filter?: MediaQueryFilter): Promise<MediaRecord[]>  // collection '*' or undefined = all
  first(collection?: string): Promise<MediaRecord | null>
  firstUrl(collection?: string, conversionName?: string): Promise<string | null>       // fallbackUrl when empty, else null
  firstSignedUrl(collection?: string, conversionName?: string, opts?: SignedUrlOptions): Promise<string | null>
  availableUrl(collection: string, conversionNames: string[]): Promise<string | null>  // first GENERATED conversion, else original url
  reorder(ids: string[]): Promise<void>
  clear(collection?: string): Promise<void>
  delete(mediaId: string): Promise<void>
}
```
`getAll` object-filter: every key/value must deep-equal `customProperties[key]`. `availableUrl` checks `generatedConversions[name] === true` in order (all false today → original; real behavior arrives in Plan 3). `clear` deletes each record via `library.deleteMedia` then emits `collection:cleared`.

- [ ] **Step 1: Write failing test** — `packages/core/test/handle.test.ts`, 6 its with the Task 11 fixture plus fs `baseUrl: 'http://localhost:9000/media'`: `getAll()` returns all collections in insertion order while `getAll('gallery')` filters; object filter `{ tag: 'x' }` matches only records added `.withCustomProperties({ tag: 'x' })`; predicate filter `(m) => m.size > 0` works; `firstUrl('empty-registered')` returns the fixture's `fallbackUrl('/d.png')` value `'/d.png'` and `firstUrl('empty-adhoc')` returns `null`, while `firstUrl('gallery')` returns a string starting `'http://localhost:9000/media/'`; after `reorder([secondId, firstId])`, `getAll('gallery')` order flips; `clear('gallery')` empties the collection, removes each record's directory from disk, and a `collection:cleared` listener receives `{ modelType: 'User', modelId: '1', collection: 'gallery' }`. Write each `it` fully.

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement** per Interfaces block.

- [ ] **Step 4: Run to verify pass** → full suite PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(core): model media handle retrieval api"`

---

### Task 13: Public exports audit + README stub

**Files:**
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/README.md`
- Test: `packages/core/test/exports.test.ts`

**Interfaces:**
- Produces: the stable import surface Plans 2–6 build on: `createMediaLibrary`, `MediaLibrary`, `collection`, `conversion`, `InMemoryMediaRepository`, all error classes, all interfaces/types above, and `@node-media-library/core/testing` exporting `runMediaRepositoryContract`.

- [ ] **Step 1: Write failing test** — `packages/core/test/exports.test.ts`: one `it` importing each public name from `'../src/index.js'` (`createMediaLibrary`, `MediaLibrary`, `collection`, `conversion`, `matchesMime`, `DEFAULT_COLLECTION`, `InMemoryMediaRepository`, `TypedEmitter`, `DefaultPathGenerator`, `DefaultUrlGenerator`, `resolveStorage`, `normalizeSource`, `validateFile`, `sanitizeFileName`, `DEFAULT_DISALLOWED_EXTENSIONS`, `FileAdder`, `ModelMediaHandle`, all 8 error classes) and `runMediaRepositoryContract` from `'../src/testing/index.js'`, asserting each `toBeDefined()`.

- [ ] **Step 2: Run and fix** — add missing re-exports to `index.ts` until PASS; `pnpm --filter @node-media-library/core typecheck` must also be clean.

- [ ] **Step 3: Write `packages/core/README.md`** — 40–60 lines: install note (pre-release), the spec §4 config example adapted to what now exists (`InMemoryMediaRepository`, fs storage), one add snippet and one retrieve snippet from Task 11/12 tests, and a roadmap note that conversions/queues/responsive/downloads land in subsequent releases (Plans 2–6).

- [ ] **Step 4: Commit** — `git commit -am "feat(core): finalize public export surface and readme stub"`

---

## Self-Review (performed at plan-writing time)

1. **Spec coverage (phases 1–3):** registry §4 → Tasks 4/10; data model §5 → Task 2; repository §6 incl. `ownerExists` → Task 5; pipeline §7 (sources, validation, sanitizer, move/preserve, collection rules, retrieval, explicit cascade, ordering) → Tasks 8–12; storage §10 (env defaults, private default, production warning, prefix, generators) → Tasks 6–7. Deferred by design to later plans: conversions/queue (§8 → Plan 3), responsive images (§9 → Plan 4), downloads/ZIP/CLI (§11/§13 → Plan 6), Prisma adapter + auto-cascade extension (§6 → Plan 2), `conversion:*`/`responsive:*` events (Plans 3–4), media-level `move`/`copy` between models (§7) — deferred to Plan 3 because `copy` re-runs conversions.
2. **Placeholder scan:** no TBDs; Tasks 11/12 Step 1 give one fully-written exemplar `it` plus per-case exact inputs and expected outcomes for the rest.
3. **Type consistency:** `MediaRecord` matches spec §5 (camelCase); `runMediaRepositoryContract` consistent across Tasks 5/13; `DEFAULT_COLLECTION` across 4/9/10; `directory()` added to `PathGenerator` beyond spec §10's three methods (needed by delete in Tasks 11/12) — recorded as a spec addendum.
