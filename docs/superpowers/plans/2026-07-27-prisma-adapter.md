# node-media-library Prisma Adapter Implementation Plan (Plan 2 of 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@node-media-library/prisma`: a `MediaRepository` implementation backed by an injected Prisma client, validated by core's exported contract suite against SQLite, plus a paste-in Media schema snippet and an opt-in delete-cascade client extension.

**Architecture:** Spec §6 (`docs/superpowers/specs/2026-07-26-node-media-library-design.md`). The adapter is **duck-typed**: it never imports a generated Prisma client type or `@prisma/client` — it accepts any object exposing a structural `media` delegate (Prisma 7 generates clients into user-owned output dirs, so nominal typing is impossible for a library). The test fixture is Prisma 7-native: `prisma-client` generator with local `output`, `prisma.config.ts`, better-sqlite3 driver adapter, `db push` + `generate` in a vitest globalSetup.

**Tech Stack:** TypeScript strict ESM, vitest, Prisma 7.9.x (dev-only), `@prisma/adapter-better-sqlite3` (dev-only), `@node-media-library/core` (workspace).

## Global Constraints

- Node >= 20 package floor (dev machine is Node 22 / v22.23.1). TypeScript strict, ESM, `.js` extensions in relative imports of package source.
- `packages/prisma` runtime deps: `@node-media-library/core` (workspace:*) ONLY. `@prisma/client` is an **optional peerDependency `">=6.2 <8"`** (6.2 floor = Json-on-SQLite support). `prisma`, `@prisma/client`, `@prisma/adapter-better-sqlite3` pinned `^7.9.0` as devDependencies for the test fixture.
- **Adapter source must never import from `@prisma/client` or any generated client** — structural interfaces only (`PrismaLikeClient`/`MediaDelegate` from Task 2). Only test files may import the generated client.
- Acceptance gate: core's exported `runMediaRepositoryContract` (from `@node-media-library/core/testing`) green against the SQLite-backed adapter.
- Prisma error detection is duck-typed on `.code` (`P2002` unique violation, `P2025` record-not-found) so it works across Prisma 6.2–7.x.
- Generated client dir and the throwaway SQLite db are git-ignored: `packages/prisma/test/prisma/generated/`, `packages/prisma/test/tmp/`.
- Prisma 7 realities this plan already accounts for (do not re-derive): generator is `provider = "prisma-client"` with required `output`; no automatic env loading; `db push` no longer auto-generates (run `generate` separately); SQLite requires the better-sqlite3 driver adapter; `orderBy: { field: { sort, nulls } }` works on SQLite; `$extends({ query: { $allModels: ... } })` unchanged.
- Commit after every task with the message given in its final step.

---

### Task 1: Package scaffold + Prisma 7 SQLite test fixture

**Files:**
- Create: `packages/prisma/package.json`, `packages/prisma/tsconfig.json`, `packages/prisma/vitest.config.ts`, `packages/prisma/prisma.config.ts`
- Create: `packages/prisma/test/prisma/schema.prisma`, `packages/prisma/test/global-setup.ts`, `packages/prisma/test/helpers/client.ts`
- Create: `packages/prisma/src/index.ts` (placeholder `export const VERSION = '0.0.0'`)
- Modify: `.gitignore` (add `packages/prisma/test/prisma/generated/` and `packages/prisma/test/tmp/`)
- Test: `packages/prisma/test/fixture.test.ts`

**Interfaces:**
- Produces: a working `getTestClient(): Promise<TestClient>` helper every later test uses; the fixture `Media`/`User`/`Post` models; test command `pnpm --filter @node-media-library/prisma test`.

- [ ] **Step 1: Create package files**

`packages/prisma/package.json`:
```json
{
  "name": "@node-media-library/prisma",
  "version": "0.0.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:prepare": "prisma db push --force-reset && prisma generate"
  },
  "dependencies": { "@node-media-library/core": "workspace:*" },
  "peerDependencies": { "@prisma/client": ">=6.2 <8" },
  "peerDependenciesMeta": { "@prisma/client": { "optional": true } },
  "devDependencies": {
    "prisma": "^7.9.0",
    "@prisma/client": "^7.9.0",
    "@prisma/adapter-better-sqlite3": "^7.9.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`packages/prisma/prisma.config.ts`:
```ts
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'test/prisma/schema.prisma',
  datasource: { url: 'file:./test/tmp/contract.db' },
})
```

`packages/prisma/test/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client"
  output   = "./generated"
}

datasource db {
  provider = "sqlite"
}

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

model User {
  id   String @id
  name String
}

model Post {
  id    String @id
  title String
}
```
(`User`/`Post` exist for Task 4's cascade tests.)

`packages/prisma/test/global-setup.ts`:
```ts
import { execSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export default function setup() {
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  mkdirSync(join(pkgRoot, 'test/tmp'), { recursive: true })
  execSync('pnpm db:prepare', { cwd: pkgRoot, stdio: 'inherit' })
}
```

`packages/prisma/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], globalSetup: ['./test/global-setup.ts'], fileParallelism: false },
})
```
(`fileParallelism: false` — one shared SQLite file; parallel test files would race.)

`packages/prisma/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"], "exclude": ["test/prisma/generated"] }
```

`packages/prisma/test/helpers/client.ts` (adjust import specifiers in Step 2 if generate emits differently):
```ts
import { PrismaClient } from '../prisma/generated/client.js'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export type TestClient = PrismaClient

let client: PrismaClient | undefined

export async function getTestClient(): Promise<TestClient> {
  if (!client) {
    const dbPath = join(dirname(fileURLToPath(import.meta.url)), '../tmp/contract.db')
    const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` })
    client = new PrismaClient({ adapter })
  }
  return client
}
```

`packages/prisma/src/index.ts`: `export const VERSION = '0.0.0'`

- [ ] **Step 2: Install, generate, verify emitted shape**

Run: `pnpm install`, then `pnpm --filter @node-media-library/prisma db:prepare`.
Inspect `test/prisma/generated/` — confirm the actual entrypoint (`client.ts` vs `index.ts`) and whether generated imports use `.ts` extensions. Decision rules (semantics fixed, specifiers adaptable):
- Adjust the `helpers/client.ts` import specifier to the real entrypoint.
- If vitest fails resolving generated `.ts`-extension imports, set `importFileExtension = "js"` (and/or `moduleFormat = "esm"`) in the generator block and re-run `db:prepare`.
- Typecheck must stay clean with `test/prisma/generated` excluded; test files that import the generated client rely on vitest's transform, not tsc.

- [ ] **Step 3: Write the fixture smoke test** — `packages/prisma/test/fixture.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { getTestClient } from './helpers/client.js'

describe('prisma 7 sqlite fixture', () => {
  it('creates and reads a media row with Json columns', async () => {
    const client = await getTestClient()
    await client.media.deleteMany({})
    const created = await client.media.create({
      data: {
        id: 'm1', uuid: 'u-1', modelType: 'User', modelId: '1',
        collectionName: 'default', name: 'a', fileName: 'a.jpg',
        mimeType: 'image/jpeg', disk: 'default', conversionsDisk: null,
        size: 1, manipulations: {}, customProperties: { nested: { k: [1, 2] } },
        generatedConversions: {}, responsiveImages: {}, orderColumn: null,
      },
    })
    expect(created.createdAt).toBeInstanceOf(Date)
    const found = await client.media.findUnique({ where: { id: 'm1' } })
    expect(found?.customProperties).toEqual({ nested: { k: [1, 2] } })
    await client.media.deleteMany({})
  })
})
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @node-media-library/prisma test` → globalSetup pushes schema + generates, smoke test PASS. `pnpm --filter @node-media-library/prisma typecheck` clean. Also `pnpm test` at root — core's 97 stay green.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore(prisma): scaffold prisma adapter package with prisma 7 sqlite fixture"`

---

### Task 2: Structural client types, row mapping, schema snippet

**Files:**
- Create: `packages/prisma/src/client.ts`, `packages/prisma/src/mapping.ts`, `packages/prisma/src/schema.ts`
- Modify: `packages/prisma/src/index.ts`
- Test: `packages/prisma/test/mapping.test.ts`

**Interfaces:**
- Consumes: `MediaRecord`, `NewMediaRecord`, `JsonObject` from `@node-media-library/core`.
- Produces:
```ts
// client.ts — structural, no @prisma/client imports
export interface MediaRow {
  id: string; modelType: string; modelId: string; uuid: string
  collectionName: string; name: string; fileName: string
  mimeType: string | null; disk: string; conversionsDisk: string | null
  size: number
  manipulations: unknown; customProperties: unknown
  generatedConversions: unknown; responsiveImages: unknown
  orderColumn: number | null; createdAt: Date; updatedAt: Date
}
export interface MediaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<MediaRow>
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<MediaRow>
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
  findUnique(args: { where: Record<string, unknown> }): Promise<MediaRow | null>
  findMany(args?: Record<string, unknown>): Promise<MediaRow[]>
  delete(args: { where: { id: string } }): Promise<MediaRow>
  deleteMany(args?: Record<string, unknown>): Promise<{ count: number }>
}
export interface PrismaLikeClient { media: MediaDelegate }

// mapping.ts
export function toMediaRecord(row: MediaRow): MediaRecord   // casts the four Json columns to their JsonObject shapes
export function toCreateData(data: NewMediaRecord): Record<string, unknown>  // passthrough of all NewMediaRecord fields (no timestamps — schema defaults own them)

// schema.ts
export const MEDIA_MODEL_SNIPPET: string  // the paste-in `model Media { ... }` block (provider-agnostic: no generator/datasource, same fields as the fixture)
```

- [ ] **Step 1: Write failing test** — `packages/prisma/test/mapping.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { toMediaRecord, toCreateData } from '../src/mapping.js'
import { MEDIA_MODEL_SNIPPET } from '../src/schema.js'

function fieldNames(modelBlock: string): string[] {
  return [...modelBlock.matchAll(/^\s{2}(\w+)\s+/gm)].map((m) => m[1]!).filter((f) => !f.startsWith('@'))
}

describe('mapping', () => {
  const row = {
    id: 'm1', modelType: 'User', modelId: '1', uuid: 'u-1',
    collectionName: 'default', name: 'a', fileName: 'a.jpg',
    mimeType: null, disk: 'default', conversionsDisk: null, size: 5,
    manipulations: {}, customProperties: { tag: 'x' },
    generatedConversions: { thumb: true }, responsiveImages: {},
    orderColumn: 2, createdAt: new Date(1), updatedAt: new Date(2),
  }
  it('toMediaRecord round-trips fields and types Json columns', () => {
    const rec = toMediaRecord(row)
    expect(rec.customProperties).toEqual({ tag: 'x' })
    expect(rec.generatedConversions.thumb).toBe(true)
    expect(rec.mimeType).toBeNull()
    expect(rec.createdAt).toBeInstanceOf(Date)
  })
  it('toCreateData carries every NewMediaRecord field and no timestamps', () => {
    const { createdAt: _c, updatedAt: _u, ...newRecord } = row
    const data = toCreateData({ ...newRecord, manipulations: {}, customProperties: {}, generatedConversions: {}, responsiveImages: {} })
    expect(data.id).toBe('m1')
    expect('createdAt' in data).toBe(false)
    expect('updatedAt' in data).toBe(false)
  })
  it('MEDIA_MODEL_SNIPPET field set matches the sqlite fixture schema', () => {
    const fixture = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'prisma/schema.prisma'), 'utf8')
    const fixtureMedia = fixture.match(/model Media \{[\s\S]*?\n\}/)![0]
    expect(new Set(fieldNames(MEDIA_MODEL_SNIPPET))).toEqual(new Set(fieldNames(fixtureMedia)))
  })
})
```

- [ ] **Step 2: Run to verify fail** — `pnpm --filter @node-media-library/prisma test` → FAIL (modules missing).

- [ ] **Step 3: Implement** — `client.ts` per Interfaces block. `mapping.ts`: `toMediaRecord` spreads the row and casts the four Json fields (`manipulations: (row.manipulations ?? {}) as MediaRecord['manipulations']`, same pattern for the others); `toCreateData` returns `{ ...data }` (NewMediaRecord already excludes timestamps). `schema.ts`: `MEDIA_MODEL_SNIPPET` template literal containing exactly the fixture's `model Media { ... }` block (same fields/attributes; keep `@@map("media")` and the `@@index`). Re-export all from `index.ts`.

- [ ] **Step 4: Run to verify pass** — tests + typecheck green.

- [ ] **Step 5: Commit** — `git commit -am "feat(prisma): structural client types, row mapping and media schema snippet"`

---

### Task 3: The adapter — contract suite green

**Files:**
- Create: `packages/prisma/src/adapter.ts`
- Modify: `packages/prisma/src/index.ts`
- Test: `packages/prisma/test/contract.test.ts`, `packages/prisma/test/adapter.test.ts`

**Interfaces:**
- Consumes: `PrismaLikeClient`, `MediaRow`, `toMediaRecord`, `toCreateData` (Task 2); `MediaRepository`, `MediaFilter`, `MediaLibraryError` from core; `runMediaRepositoryContract` from `@node-media-library/core/testing`.
- Produces:
```ts
export interface PrismaAdapterOptions {
  owners?: Record<string, (modelId: string) => boolean | Promise<boolean>>
  iterateBatchSize?: number   // default 100
}
export function prismaAdapter(client: PrismaLikeClient, opts?: PrismaAdapterOptions): MediaRepository
```
Semantics: `create` maps duck-typed Prisma error `P2002` → `MediaLibraryError(code 'DUPLICATE_ID')`; `update` maps `P2025` → `MediaLibraryError(code 'NOT_FOUND')`; `delete` swallows `P2025` (idempotent); `findForModel` uses `orderBy: [{ orderColumn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]` and adds `collectionName` to `where` only when `collection !== undefined`; `setOrder(ids, startAt = 1)` loops `updateMany({ where: { id }, data: { orderColumn } })` sequentially (updateMany silently skips unknown ids — matching in-memory semantics); `iterateAll` pages `findMany` with the same orderBy plus `{ id: 'asc' }` tiebreak, `take: batchSize`, cursor `{ id: lastId }, skip: 1`; `ownerExists(type, id)` → `opts.owners?.[type]` ? await it : `true`.

- [ ] **Step 1: Write the failing tests**

`packages/prisma/test/contract.test.ts` (the acceptance gate):
```ts
import { runMediaRepositoryContract } from '@node-media-library/core/testing'
import { prismaAdapter } from '../src/adapter.js'
import { getTestClient } from './helpers/client.js'

runMediaRepositoryContract('PrismaMediaRepository (sqlite)', async () => {
  const client = await getTestClient()
  await client.media.deleteMany({})
  return prismaAdapter(client)
})
```

`packages/prisma/test/adapter.test.ts` — adapter-specific behavior beyond the contract. One exemplar written fully; the other two specified by exact inputs/outcomes — write all three fully in the file:
```ts
it('ownerExists defaults to true and consults opts.owners', async () => {
  const client = await getTestClient()
  const bare = prismaAdapter(client)
  expect(await bare.ownerExists('User', 'nope')).toBe(true)
  const scoped = prismaAdapter(client, { owners: { User: (id) => id === 'u1' } })
  expect(await scoped.ownerExists('User', 'u1')).toBe(true)
  expect(await scoped.ownerExists('User', 'u2')).toBe(false)
})
```
Remaining two: `iterateAll paginates across batches` — seed 7 records via `adapter.create`, build `prismaAdapter(client, { iterateBatchSize: 3 })`, collect `iterateAll()` into an array, expect all 7 ids present exactly once. `delete is idempotent for unknown ids` — `await adapter.delete('never-existed')` resolves without throwing.

- [ ] **Step 2: Run to verify fail** — contract suite FAILS (adapter module missing).

- [ ] **Step 3: Implement `adapter.ts`** — one class `PrismaMediaRepository implements MediaRepository` + the `prismaAdapter` factory. Duck-typed error check:
```ts
function prismaErrorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined
}
```
All reads map through `toMediaRecord`; `create` returns the mapped row Prisma gives back (timestamps stamped by schema defaults).

- [ ] **Step 4: Run to verify pass** — full package suite green (contract its + adapter its + prior). Root `pnpm test` still green. Typecheck clean.

- [ ] **Step 5: Commit** — `git commit -am "feat(prisma): media repository adapter passing core contract suite on sqlite"`

---

### Task 4: Opt-in delete-cascade client extension

**Files:**
- Create: `packages/prisma/src/cascade.ts`
- Modify: `packages/core/src/library.ts` (add public `get modelTypes(): string[]` returning the registered model type names), `packages/core/test/library.test.ts` (one `it`), `packages/prisma/src/index.ts`
- Test: `packages/prisma/test/cascade.test.ts`

**Interfaces:**
- Consumes: `MediaLibrary` (core), `PrismaLikeClient` (Task 2), `prismaAdapter` (Task 3).
- Produces:
```ts
// core/src/library.ts addition
get modelTypes(): string[]   // Object.keys of the resolved models registry

// prisma/src/cascade.ts
export interface CascadeOptions { models?: string[] }  // default: media.modelTypes
export function withMediaCascade<C extends PrismaLikeClient & { $extends(ext: unknown): unknown }>(
  client: C, media: MediaLibrary, opts?: CascadeOptions,
): C
```
Behavior: returns `client.$extends({ query: { $allModels: { delete, deleteMany } } }) as C`. For `delete`: run `query(args)` first; if the model is in scope and the result has an `id`, `await media.clearFor(model, String(result.id))`; return the result. For `deleteMany`: if in scope, pre-fetch ids via the BASE client's delegate (`client[modelKey(model)].findMany({ where: args?.where, select: { id: true } })`, where `modelKey` lower-cases the first letter), run `query(args)`, then `clearFor` each id; out-of-scope models pass through untouched. Media rows live in the `media` table, so deleting the owner row never touches them — `clearFor` does (rows + files).

- [ ] **Step 1: Write failing core test** — add to `packages/core/test/library.test.ts`:
```ts
it('exposes registered model types', () => {
  expect(makeLibrary().modelTypes).toEqual(['User'])
})
```
Run core tests → FAIL. Implement the getter in `library.ts`, run → PASS.

- [ ] **Step 2: Write failing cascade tests** — `packages/prisma/test/cascade.test.ts`. Fixture: `createMediaLibrary` with `prismaAdapter(client)` repository, fs storage in a temp dir, models `{ User: {} }`; wrap: `const xclient = withMediaCascade(client, media)`. Three its — exemplar written fully, write all three fully in the file:
```ts
it('user.delete cascades media rows and files', async () => {
  await client.user.create({ data: { id: 'u1', name: 'A' } })
  const m = await media.for('User', 'u1').add(png).toCollection('default')
  await xclient.user.delete({ where: { id: 'u1' } })
  expect(await media.for('User', 'u1').getAll()).toEqual([])
  expect(existsSync(join(root, m.id))).toBe(false)
})
```
Remaining two: `user.deleteMany cascades only matching users` — create u2 + u3 each with one media, `xclient.user.deleteMany({ where: { id: 'u2' } })` → u2's media gone (rows + directory), u3's intact. `models outside the registry pass through untouched` — `client.post.create` a row, insert a media row with modelType 'Post' via `adapter.create`, `xclient.post.delete` → post row gone, the 'Post' media row still present (Post not registered in `media`).

- [ ] **Step 3: Run to verify fail** → FAIL (cascade module missing).

- [ ] **Step 4: Implement `cascade.ts`** per the behavior spec above. `modelKey(model: string)` = first char lower-cased + rest.

- [ ] **Step 5: Run to verify pass** — both packages' suites + typecheck green (`pnpm test` at root).

- [ ] **Step 6: Commit** — `git commit -am "feat(prisma): opt-in delete cascade client extension"`

---

### Task 5: Public exports audit + README

**Files:**
- Modify: `packages/prisma/src/index.ts`
- Create: `packages/prisma/README.md`
- Test: `packages/prisma/test/exports.test.ts`

**Interfaces:**
- Produces: stable public surface: `prismaAdapter`, `PrismaAdapterOptions`, `withMediaCascade`, `CascadeOptions`, `MEDIA_MODEL_SNIPPET`, `PrismaLikeClient`, `MediaDelegate`, `MediaRow`, `toMediaRecord`, `toCreateData`.

- [ ] **Step 1: Write failing test** — `packages/prisma/test/exports.test.ts`: one `it` importing each of the 10 names above from `'../src/index.js'`, asserting each `toBeDefined()` (pure types via `import type` plus a trivial type-position usage so typecheck validates them).

- [ ] **Step 2: Run, fix `index.ts` re-exports until green.** Typecheck clean.

- [ ] **Step 3: Write `packages/prisma/README.md`** — 40–60 lines (verify with `wc -l`): pre-release note; install (`Once published:` framing, listing the `@prisma/client >=6.2` optional peer); "Add the model" section pasting `MEDIA_MODEL_SNIPPET` contents and telling users to run their own migrate flow; one-line Prisma 7 note (v7 generates clients into your own output dir — pass the instance in); usage snippet wiring `prismaAdapter(prisma)` into `createMediaLibrary` (mirror the real API from cascade.test.ts); cascade opt-in snippet (`withMediaCascade(prisma, media)`); `owners` option note (needed only for the future `clean --delete-orphaned`, Plan 6); roadmap line. Every snippet must use APIs exactly as exported.

- [ ] **Step 4: Run full root suite + typecheck** — everything green.

- [ ] **Step 5: Commit** — `git commit -am "feat(prisma): finalize public export surface and readme"`

---

## Self-Review (performed at plan-writing time)

1. **Spec §6 coverage:** MediaRepository implementation → Task 3; paste-in Prisma schema snippet → Tasks 1/2 (fixture + exported snippet with parity test); contract suite against SQLite → Task 3 (acceptance gate); opt-in client extension for delete cascade → Task 4; adapter package with peer `@prisma/client` → Task 1. `ownerExists` for Plan 6's clean command → Task 3 (`owners` option). Nothing from §6 remains uncovered.
2. **Placeholder scan:** Tasks 3/4 use the one-full-exemplar + exact-inputs/outcomes convention from Plan 1 for their remaining `it`s; no TBDs. Task 1 Step 2 is a bounded verify-and-adapt step with explicit decision rules (generated entrypoint name, import extensions) — Prisma 7's generated layout must be confirmed against real output, not guessed.
3. **Type consistency:** `PrismaLikeClient`/`MediaDelegate`/`MediaRow` defined in Task 2, consumed verbatim in Tasks 3/4/5; `prismaAdapter(client, opts?)` identical across Tasks 3/4/5; `withMediaCascade(client, media, opts?)` across Tasks 4/5; core addition `modelTypes` added in Task 4 Step 1 before first use; `runMediaRepositoryContract(name, factory)` matches core's actual export (verified against source this session).
