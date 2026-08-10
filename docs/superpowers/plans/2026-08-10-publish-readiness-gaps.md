# Publish-Readiness Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the recommended Prisma schema, the `@prisma/client` peer range, and core's export surface before the first npm publish, while breaking changes are still free.

**Architecture:** Three independent changes, each guarded by a test that fails before the change and passes after. The Prisma schema snippet becomes snake_case-mapped and its three copies (constant, test fixture, README) are locked together by a parity test. The peer range narrows to what CI proves, guarded by a manifest/README drift test. Core's barrel stops wildcarding the storage module, so `@internal` means something.

**Tech Stack:** TypeScript (ESM, NodeNext), vitest, Prisma 7, pnpm workspaces, changesets, typedoc.

## Global Constraints

- ESM with explicit extensions: relative imports carry a `.js` suffix even in TypeScript source.
- Prettier: no semicolons, single quotes, 2-space indent, 100 columns. Config lives under the `prettier` key in the root `package.json`. `.prettierignore` excludes `**/package.json` and `docs/superpowers/plans` — do not reformat either.
- Tests live in each package's `test/` directory, never colocated in `src/`.
- Conventional Commits with a package scope minus the `@node-media-library/` prefix: `fix(prisma): ...`, `fix(core): ...`, `chore: ...`.
- `pnpm` only. `npm` will not work — each package's `prepack` deliberately fails under bare npm.
- Docs must match shipped behavior. A README or JSDoc claim that over- or under-states what the code does is a defect, not a nitpick.
- Nothing is published to npm, so no change here is breaking for any adopter.
- The `@prisma/client` peer range after this plan is exactly `>=7 <8`.
- The `media` table's column names after this plan are exactly `spatie/laravel-medialibrary`'s: `model_type`, `model_id`, `collection_name`, `file_name`, `mime_type`, `conversions_disk`, `custom_properties`, `generated_conversions`, `responsive_images`, `order_column`, `created_at`, `updated_at`.

## File Structure

**Task 1 — Prisma schema snippet**

- Modify `packages/prisma/src/schema.ts` — the canonical `MEDIA_MODEL_SNIPPET` constant.
- Modify `packages/prisma/test/prisma/schema.prisma` — the SQLite test fixture, which must carry a byte-identical `model Media` block.
- Modify `packages/prisma/README.md` — the third copy of the block, plus the new `iterateAll` limitation note.
- Modify `packages/prisma/test/mapping.test.ts` — parity test tightened from field-name sets to normalized-body equality across all three copies.

**Task 2 — Peer range**

- Modify `packages/prisma/package.json:54` — the peer range.
- Modify `packages/prisma/README.md:8` — the quoted range.
- Modify `packages/prisma/test/exports.test.ts` — new drift test asserting the README quotes the manifest's range verbatim.

**Task 3 — Core export surface**

- Modify `packages/core/src/storage/resolve.ts:97` — drop `@internal` from `ResolvedStorage`.
- Modify `packages/core/src/index.ts:9` — replace the wildcard with named exports.
- Modify `packages/core/test/exports.test.ts:55-58` — invert the existing `resolveStorage` assertion.
- Regenerate `website/src/content/docs/api/**` — `ResolvedStorage` becomes visible to typedoc.

**Task 4 — Changesets and full verification**

- Create two files under `.changeset/`.

---

### Task 1: Prisma schema snippet — mapping, index, honesty, parity

**Files:**

- Modify: `packages/prisma/src/schema.ts:1-24`
- Modify: `packages/prisma/test/prisma/schema.prisma:10-32`
- Modify: `packages/prisma/README.md:14-38` and after line 44
- Test: `packages/prisma/test/mapping.test.ts:8-12,55-62`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `MEDIA_MODEL_SNIPPET: string` (unchanged export name and type — only its contents change). No function signatures change. `packages/prisma/src/adapter.ts` and `mapping.ts` name Prisma _fields_ only and must not be touched.

**Background the implementer needs:**

Prisma separates the field name your code uses from the column name in the database. `@map("model_type")` on a field means "call this column `model_type` in SQL, but `modelType` in the client". The adapter already only ever writes `modelType`, so adding `@map` changes the database and nothing else. `@@map("media")` does the same for the table name and is already present.

The block currently lives in three places that are supposed to agree: the exported constant, the SQLite test fixture, and the README code block (which claims the constant is "exported verbatim"). Nothing enforces that today — the existing test compares only the _set of field names_, so the three could disagree on every `@map` target and still pass. Step 1 fixes the test first.

The test fixture is regenerated automatically: `packages/prisma/test/global-setup.ts:18` runs `pnpm db:prepare` (`prisma db push && prisma generate`) before every test run, after deleting the scratch database. There is no manual regeneration step.

- [ ] **Step 1: Write the failing parity test**

Replace the `fieldNames` helper at `packages/prisma/test/mapping.test.ts:8-12` with:

```ts
function normalizeModel(block: string): string {
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
}

function extractMediaModel(source: string): string {
  const match = source.match(/model Media \{[\s\S]*?\n\}/)
  if (!match) throw new Error('no `model Media { ... }` block found')
  return normalizeModel(match[0])
}
```

Replace the test at `packages/prisma/test/mapping.test.ts:55-62` with:

```ts
it('MEDIA_MODEL_SNIPPET, the sqlite fixture, and the README agree exactly', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const fixture = readFileSync(join(here, 'prisma/schema.prisma'), 'utf8')
  const readme = readFileSync(join(here, '../README.md'), 'utf8')

  const snippet = normalizeModel(MEDIA_MODEL_SNIPPET)
  expect(extractMediaModel(fixture)).toBe(snippet)
  expect(extractMediaModel(readme)).toBe(snippet)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @node-media-library/prisma test mapping`

Expected: FAIL. The fixture lacks the `// size Int supports files up to ~2GB...` comment that the constant carries, so the normalized bodies already differ before any `@map` is added.

- [ ] **Step 3: Rewrite the canonical snippet**

Replace the entire contents of `packages/prisma/src/schema.ts` with:

```ts
export const MEDIA_MODEL_SNIPPET = `model Media {
  id                   String   @id
  modelType            String   @map("model_type")
  modelId              String   @map("model_id")
  uuid                 String   @unique
  collectionName       String   @map("collection_name")
  name                 String
  fileName             String   @map("file_name")
  mimeType             String?  @map("mime_type")
  disk                 String
  conversionsDisk      String?  @map("conversions_disk")
  // size Int caps individual files at ~2GB. Raising it is a library change, not a
  // schema-only one: MediaRow and core's MediaRecord both type size as number.
  size                 Int
  manipulations        Json
  customProperties     Json     @map("custom_properties")
  generatedConversions Json     @map("generated_conversions")
  responsiveImages     Json     @map("responsive_images")
  orderColumn          Int?     @map("order_column")
  createdAt            DateTime @default(now()) @map("created_at")
  updatedAt            DateTime @updatedAt @map("updated_at")

  @@index([modelType, modelId, collectionName])
  @@map("media")
}`
```

Note: the closing line is `}` immediately followed by the template literal's backtick — no escape. Note also: the index gains `collectionName` as a third column. Do **not** append `orderColumn` or `createdAt` — the two-column prefix still serves collection-less reads, and no single index can serve both `findForModel` shapes' ordering.

- [ ] **Step 4: Replace the fixture's model block**

In `packages/prisma/test/prisma/schema.prisma`, replace lines 10-32 (the `model Media { ... }` block only — leave the `generator`, `datasource`, `User`, and `Post` blocks untouched) with the identical block:

```prisma
model Media {
  id                   String   @id
  modelType            String   @map("model_type")
  modelId              String   @map("model_id")
  uuid                 String   @unique
  collectionName       String   @map("collection_name")
  name                 String
  fileName             String   @map("file_name")
  mimeType             String?  @map("mime_type")
  disk                 String
  conversionsDisk      String?  @map("conversions_disk")
  // size Int caps individual files at ~2GB. Raising it is a library change, not a
  // schema-only one: MediaRow and core's MediaRecord both type size as number.
  size                 Int
  manipulations        Json
  customProperties     Json     @map("custom_properties")
  generatedConversions Json     @map("generated_conversions")
  responsiveImages     Json     @map("responsive_images")
  orderColumn          Int?     @map("order_column")
  createdAt            DateTime @default(now()) @map("created_at")
  updatedAt            DateTime @updatedAt @map("updated_at")

  @@index([modelType, modelId, collectionName])
  @@map("media")
}
```

- [ ] **Step 5: Replace the README's model block**

In `packages/prisma/README.md`, replace the contents of the fenced `prisma` code block at lines 15-37 with the identical block (same text as Step 4).

- [ ] **Step 6: Run the parity test to verify it passes**

Run: `pnpm --filter @node-media-library/prisma test mapping`

Expected: PASS. If it fails, diff the three blocks — the assertion message prints both normalized bodies.

- [ ] **Step 7: Run the full prisma suite**

Run: `pnpm --filter @node-media-library/prisma test`

Expected: PASS, all files. `global-setup.ts` drops the scratch db and re-pushes the remapped schema automatically, so the contract suite exercises the new columns. If the adapter or contract suite fails here, the `@map` additions leaked into code that names columns — find it and revert that leak; no adapter change is in scope.

- [ ] **Step 8: Add the `iterateAll` limitation note to the README**

In `packages/prisma/README.md`, immediately after the ordering paragraph that currently ends `...before relying on it there.` (line 44), add:

```markdown
`iterateAll({ collectionName })` filters on `collectionName` without `modelType`, which the
`[modelType, modelId, collectionName]` index cannot serve — each batch is a sequential scan. That is
fine at the scale `clean` runs today; add a `[collectionName]` index if you run it against a large
table.
```

- [ ] **Step 9: Update the `size` note under the README's model block**

In `packages/prisma/README.md`, replace line 42 — currently `` `size Int` supports files up to ~2GB; switch to `BigInt` (and adjust `MediaRow`) for larger files. `` — with:

```markdown
`size Int` caps individual files at ~2GB. Raising it is a library change, not a schema-only one:
`MediaRow` and core's `MediaRecord` both type `size` as `number`, so changing the column alone would
hand `bigint` to code expecting `number`.
```

- [ ] **Step 10: Format and verify the whole package**

Run: `pnpm format && pnpm --filter @node-media-library/prisma typecheck && pnpm --filter @node-media-library/prisma test`

Expected: all PASS. `pnpm format` does not touch `.prisma` files or `package.json`.

- [ ] **Step 11: Commit**

```bash
git add packages/prisma/src/schema.ts packages/prisma/test/prisma/schema.prisma packages/prisma/test/mapping.test.ts packages/prisma/README.md
git commit -m "fix(prisma): map schema snippet columns to snake_case and widen the index"
```

---

### Task 2: Narrow the `@prisma/client` peer range

**Files:**

- Modify: `packages/prisma/package.json:54`
- Modify: `packages/prisma/README.md:8`
- Test: `packages/prisma/test/exports.test.ts`

**Interfaces:**

- Consumes: nothing from Task 1. This task is independent and may be done in either order.
- Produces: no code symbols. The manifest's `peerDependencies['@prisma/client']` string becomes `">=7 <8"`, and `packages/prisma/test/exports.test.ts` gains a test that reads it.

**Background the implementer needs:**

The manifest claims `>=6.2 <8`, but `.github/workflows/ci.yml` has one test leg installing the workspace lockfile's `@prisma/client ^7.9.1`. No 6.x is exercised. The adapter never imports `@prisma/client` — it is structurally typed via `PrismaLikeClient` in `packages/prisma/src/client.ts` — so narrowing costs nothing and widening later is a minor bump.

`peerDependenciesMeta.optional` stays `true`. Do not remove it: consumers who import only this package's types, without a Prisma client installed, would break.

Note that `.prettierignore` excludes `**/package.json`, which is hand-formatted with compact single-line objects. Edit it by hand and do not run a formatter over it.

- [ ] **Step 1: Write the failing drift test**

Add these imports at the top of `packages/prisma/test/exports.test.ts`, below the existing `vitest` import:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
```

Then append at the end of the file, at the top level:

```ts
describe('peer range', () => {
  const here = dirname(fileURLToPath(import.meta.url))

  function peerRange(): string {
    const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    return pkg.peerDependencies['@prisma/client']!
  }

  it('is exactly the range CI proves', () => {
    expect(peerRange()).toBe('>=7 <8')
  })

  it('is quoted verbatim in the README', () => {
    const readme = readFileSync(join(here, '../README.md'), 'utf8')
    expect(readme).toContain(`\`${peerRange()}\``)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @node-media-library/prisma test exports`

Expected: FAIL on the first test with `expected '>=6.2 <8' to be '>=7 <8'`.

- [ ] **Step 3: Narrow the manifest**

In `packages/prisma/package.json`, change line 54 from:

```json
    "@prisma/client": ">=6.2 <8"
```

to:

```json
    "@prisma/client": ">=7 <8"
```

Leave `peerDependenciesMeta` (lines 56-60) exactly as it is.

- [ ] **Step 4: Update the README**

In `packages/prisma/README.md`, change line 8 from:

```markdown
`@prisma/client` (`>=6.2 <8`) is an optional peer dependency — bring your own version.
```

to:

```markdown
`@prisma/client` (`>=7 <8`) is an optional peer dependency — bring your own version. The range is
what CI exercises; the adapter itself is structurally typed and never imports `@prisma/client`, so
support for older majors can be widened later once a CI leg proves it.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @node-media-library/prisma test exports`

Expected: PASS, both tests.

- [ ] **Step 6: Verify the lockfile is undisturbed**

Run: `git diff --stat pnpm-lock.yaml`

Expected: no output. Narrowing a peer range that the installed `^7.9.1` already satisfies does not change resolution. If the lockfile did change, you ran an install — revert it with `git checkout pnpm-lock.yaml`.

- [ ] **Step 7: Commit**

```bash
git add packages/prisma/package.json packages/prisma/README.md packages/prisma/test/exports.test.ts
git commit -m "fix(prisma): narrow @prisma/client peer range to the range CI proves"
```

---

### Task 3: Narrow core's export surface

**Files:**

- Modify: `packages/core/src/storage/resolve.ts:97`
- Modify: `packages/core/src/index.ts:9`
- Modify: `packages/core/test/exports.test.ts:55-58`
- Regenerate: `website/src/content/docs/api/**`

**Interfaces:**

- Consumes: nothing from Tasks 1-2.
- Produces: `@node-media-library/core`'s barrel exports exactly these four symbols from the storage module — `DiskConfig`, `StorageConfig`, `S3Credentials`, `ResolvedStorage` (all type-only). `resolveStorage`, `normalizeR2`, and `writeOptionsFor` are no longer reachable from the barrel; code needing them must import from `'./storage/resolve.js'` directly.

**Background the implementer needs:**

`packages/core/src/index.ts:9` is `export * from './storage/resolve.js'`. That module exports seven symbols; three carry `/** @internal */`. The tag does nothing to the emitted `.d.ts` — no tsconfig sets `stripInternal` — so all seven ship today.

One of the three is mislabeled rather than over-exported: `ResolvedStorage` is the return type of the **public** getter `MediaLibrary.storage` at `packages/core/src/library.ts:331`. A consumer cannot write typed code against that getter without naming the type. It must stay public and lose the tag.

Two things will surprise you if you don't know them up front:

1. `packages/core/test/exports.test.ts:55-58` currently asserts `resolveStorage` **is** exported. It must be inverted, not merely supplemented.
2. `packages/core/typedoc.json` sets `"excludeInternal": true`. Removing `ResolvedStorage`'s tag makes it appear in the generated API reference under `website/src/content/docs/api/`, which is **committed**. `.github/workflows/ci.yml:71-86` regenerates and fails on any diff. You must regenerate and commit that output or CI will fail on a change you did make but did not record.

Core's own source is unaffected: `config.ts`, `conversions/engine.ts`, `library.ts`, `storage/visibility-check.ts`, and `storage/url-generator.ts` all import from `'./storage/resolve.js'` (or `'../storage/resolve.js'`) directly, never through the barrel. The tests that use the internal symbols — `s3-disk.test.ts`, `gcs-disk.test.ts`, `storage-resolve.test.ts` — likewise import the module directly and need no change.

- [ ] **Step 1: Invert the failing export test**

In `packages/core/test/exports.test.ts`, replace lines 55-58 — currently:

```ts
it('exports resolveStorage', async () => {
  const { resolveStorage } = await import('../src/index.js')
  expect(resolveStorage).toBeDefined()
})
```

with:

```ts
// The barrel deliberately does not re-export the storage resolver. It is a thin
// flydrive wrapper, and flydrive is pinned to ^1 (2.x needs Node >=24); making it
// public would freeze that pin into this package's own semver surface. Consumers
// wanting storage without media should depend on flydrive directly.
it('does not export resolveStorage, normalizeR2, or writeOptionsFor', async () => {
  const mod = await import('../src/index.js')
  expect('resolveStorage' in mod).toBe(false)
  expect('normalizeR2' in mod).toBe(false)
  expect('writeOptionsFor' in mod).toBe(false)
})

it('exports the storage config types', async () => {
  // Type-only exports are invisible at runtime; `tsc --noEmit` is what proves
  // these four still resolve through the barrel.
  const disk: import('../src/index.js').DiskConfig = { driver: 'fs', root: '/tmp' }
  const config: import('../src/index.js').StorageConfig = { disks: { default: disk } }
  const creds: import('../src/index.js').S3Credentials = {
    accessKeyId: 'a',
    secretAccessKey: 'b',
  }
  const storage: import('../src/index.js').ResolvedStorage | undefined = undefined
  expect(config).toBeDefined()
  expect(creds).toBeDefined()
  expect(storage).toBeUndefined()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @node-media-library/core test exports`

Expected: FAIL on `does not export resolveStorage...` with `expected true to be false` — the wildcard is still in place.

- [ ] **Step 3: Replace the barrel's wildcard with named exports**

In `packages/core/src/index.ts`, replace line 9:

```ts
export * from './storage/resolve.js'
```

with:

```ts
// Named rather than `export *`: the module also exports resolveStorage,
// normalizeR2, and writeOptionsFor, which are @internal. Without this,
// `export *` re-widens the public surface silently — exports.test.ts guards it.
export type {
  DiskConfig,
  StorageConfig,
  S3Credentials,
  ResolvedStorage,
} from './storage/resolve.js'
```

- [ ] **Step 4: Drop the `@internal` tag from `ResolvedStorage`**

In `packages/core/src/storage/resolve.ts`, replace line 97 — the `/** @internal */` immediately above `export interface ResolvedStorage {` — with:

```ts
/**
 * The storage layer a `MediaLibrary` resolved from its config. Public because
 * `MediaLibrary.storage` returns it — typed code against that getter needs the
 * name. Constructing one is not part of the public surface; `resolveStorage`
 * stays internal.
 */
```

Leave the `@internal` tags on `writeOptionsFor` (line 11), `normalizeR2` (line 162), and `resolveStorage` (line 179) exactly as they are.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @node-media-library/core test exports`

Expected: PASS.

- [ ] **Step 6: Typecheck the whole workspace**

Run: `pnpm -r typecheck`

Expected: PASS everywhere. This is what proves Step 1's type-only assertions and catches any package that reached the removed symbols through the barrel. If a sibling package fails, change its import to `@node-media-library/core`'s public surface — do not re-add the wildcard.

- [ ] **Step 7: Run the full core suite**

Run: `pnpm --filter @node-media-library/core test`

Expected: PASS, all files.

- [ ] **Step 8: Regenerate the committed API reference**

Run: `pnpm --filter @node-media-library/core docs:api`

Then: `git diff --stat website/src/content/docs/api`

Expected: a non-empty diff adding `ResolvedStorage` to the reference. If the diff is empty, `excludeInternal` did not pick up the change — confirm Step 4 actually removed the tag rather than leaving a second one.

- [ ] **Step 9: Format and re-verify**

Run: `pnpm format && pnpm format:check && pnpm -r typecheck && pnpm -r test`

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/storage/resolve.ts packages/core/test/exports.test.ts website/src/content/docs/api
git commit -m "fix(core): narrow the barrel's storage exports to the sanctioned four"
```

---

### Task 4: Changesets and final verification

**Files:**

- Create: `.changeset/prisma-schema-and-peer-range.md`
- Create: `.changeset/core-storage-export-surface.md`

**Interfaces:**

- Consumes: Tasks 1, 2, and 3 must all be committed first — the changeset text describes their combined effect.
- Produces: nothing consumed by later work. This is the final task.

**Background the implementer needs:**

CLAUDE.md requires a changeset for any user-facing change, skippable only for tests, internal refactors, CI, or tooling. All three tasks are user-facing. Nothing is published, so the version bumps protect no adopter, but the changelog entries are the record of why the schema and surface look the way they do.

Both entries are `patch`. A `minor` would be defensible for the export narrowing, but with nothing published there is no consumer to signal, and `patch` keeps every package on the same 1.0.x line.

- [ ] **Step 1: Write the prisma changeset**

Create `.changeset/prisma-schema-and-peer-range.md`:

```markdown
---
'@node-media-library/prisma': patch
---

Map the recommended schema's columns to snake_case, widen the index, and narrow the peer range.

`MEDIA_MODEL_SNIPPET` now carries field-level `@map()`, so pasting it yields the same column names
as `spatie/laravel-medialibrary` instead of quoted camelCase identifiers on Postgres. The adapter is
unaffected — it names Prisma fields, never columns.

`@@index` widens to `[modelType, modelId, collectionName]` so collection-scoped `findForModel` reads
stay covered; the two-column prefix still serves collection-less reads.

`@prisma/client` narrows to `>=7 <8`, the range CI actually exercises. The adapter is structurally
typed and never imports `@prisma/client`, so older majors can be re-admitted later once a CI leg
proves them.

The `size`/`BigInt` note is corrected: it told users to adjust `MediaRow`, a library type they cannot
change. `iterateAll({ collectionName })`'s missing index is now documented.
```

- [ ] **Step 2: Write the core changeset**

Create `.changeset/core-storage-export-surface.md`:

```markdown
---
'@node-media-library/core': patch
---

Narrow the barrel's storage exports to `DiskConfig`, `StorageConfig`, `S3Credentials`, and
`ResolvedStorage`.

`resolveStorage`, `normalizeR2`, and `writeOptionsFor` are no longer reachable from the package root.
They were only ever exported by an `export *`, and their `@internal` tags stripped nothing, since no
tsconfig sets `stripInternal`.

`ResolvedStorage` loses its `@internal` tag. `MediaLibrary.storage` is a public getter returning it,
so the type was already part of the contract and the tag was simply wrong.
```

- [ ] **Step 3: Verify the changesets parse**

Run: `pnpm changeset status`

Expected: both changesets listed, `@node-media-library/core` and `@node-media-library/prisma` each bumping patch. If it errors on frontmatter, check the package names are exact and the `---` fences are on their own lines.

- [ ] **Step 4: Run the full CI gate locally**

Run: `pnpm format:check && pnpm -r typecheck && pnpm -r build && pnpm -r test`

Expected: all PASS. Local skips are expected for the binary-gated suites (`pdftoppm`, `ffmpeg`, `jpegoptim`, `pngquant`) and for BullMQ/RabbitMQ without `REDIS_URL`/`AMQP_URL` — those are CI's job. Any other failure is yours.

- [ ] **Step 5: Verify the API reference is not stale**

Run: `pnpm --filter @node-media-library/core docs:api && git diff --quiet -- website/src/content/docs/api && echo CLEAN || echo STALE`

Expected: `CLEAN`. `STALE` means Task 3 Step 8's regeneration was not committed — commit it now, because CI fails on this exact check.

- [ ] **Step 6: Commit**

```bash
git add .changeset
git commit -m "chore: add changesets for the publish-readiness fixes"
```

---

## Self-Review

**Spec coverage.** Every section of `docs/superpowers/specs/2026-08-10-publish-readiness-gaps-design.md` maps to a task:

| Spec section | Task |
| --- | --- |
| §3.1 field mapping | Task 1, Steps 3-5 |
| §3.2 index | Task 1, Step 3 |
| §3.3 `size`/`BigInt` comment | Task 1, Steps 3, 4, 9 |
| §3.4 fixture parity + tightened test | Task 1, Steps 1, 4, 6 |
| §3.5 `iterateAll` limitation note | Task 1, Step 8 |
| §4.1 `ResolvedStorage` un-tagged | Task 3, Step 4 |
| §4.2 barrel named exports | Task 3, Step 3 |
| §4.3 surface test asserting the negative | Task 3, Step 1 |
| §5 peer range | Task 2, Steps 3-4 |
| §7 testing | Tasks 1 Step 7, 2 Step 5, 3 Steps 6-7, 4 Step 4 |
| §8 changesets | Task 4 |
| §9 success criteria | Task 4, Steps 4-5 |

**Three corrections to the spec, made here rather than deferred.** Each was found while reading the code the spec's tasks touch:

1. Spec §7 says `db:prepare` "must regenerate cleanly against the remapped fixture before the suite runs", implying a manual step. `packages/prisma/test/global-setup.ts:18` already runs it on every test invocation. Task 1 Step 7 states this rather than adding a redundant step.
2. Spec §4 does not mention that `packages/core/test/exports.test.ts:55-58` **asserts the opposite** of what §4.3 requires. Task 3 Step 1 inverts it.
3. Spec §7 does not mention the committed API reference. `packages/core/typedoc.json` sets `excludeInternal: true`, so §4.1's un-tagging changes generated output that `.github/workflows/ci.yml:71-86` diff-checks. Task 3 Step 8 and Task 4 Step 5 cover it. **Without this the branch fails CI on green local tests.**

One addition beyond the spec: the parity test covers the README's copy of the block as well as the fixture's, because `packages/prisma/README.md:40` claims the constant is "exported verbatim" — a claim nothing enforced. Task 1 Step 1.

**Placeholder scan.** No `TBD`, `TODO`, "similar to Task N", or "add appropriate error handling". Every code step carries the literal text to write. The schema block is repeated in full in Steps 3, 4, and 5 rather than cross-referenced, because the three files must be byte-identical and an implementer reading out of order would otherwise guess.

**Type consistency.** `MEDIA_MODEL_SNIPPET` keeps its name and `string` type throughout. The four kept type exports are spelled `DiskConfig`, `StorageConfig`, `S3Credentials`, `ResolvedStorage` identically in Task 3 Steps 1 and 3, in the Interfaces block, and in the changeset. The three removed symbols are spelled `resolveStorage`, `normalizeR2`, `writeOptionsFor` identically in Task 3 Steps 1, 3, 4, and the changeset. `normalizeModel` and `extractMediaModel` are defined in Task 1 Step 1 and used only there.
