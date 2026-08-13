# Consumer-Readiness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six consumer-readiness gaps in
[the spec](../specs/2026-08-12-consumer-readiness-fixes-design.md) so the monorepo can publish seven
correct, mutually consistent tarballs at version 1.0.0.

**Architecture:** Six independent code changes plus a release-mechanics pass. Nothing shares state;
the only ordering constraints are Task 3 before Task 4 (helper before the manifest that requires it)
and Task 5 before Task 6 (shared filter semantics before the Prisma backend that must match them).
Tasks 10 and 11 come last because they describe what actually shipped.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), pnpm workspaces, vitest, changesets, Prisma,
sharp.

## Global Constraints

- **ESM with explicit extensions.** Relative imports carry a `.js` suffix even in TypeScript source:
  `import { x } from './thing.js'`.
- **Prettier**, configured under the `prettier` key in the root `package.json`: no semicolons, single
  quotes, 2-space indent, 100 columns. CI gates on `pnpm format:check`. `.prettierignore` excludes
  `**/package.json` and `docs/superpowers/plans` — never reformat either.
- **Tests live in each package's `test/` directory**, never colocated in `src/`.
- **Tests hit real boundaries** — real temp files, a real SQLite database, real subprocesses. Do not
  mock those seams.
- **Dual export maps.** Each package declares `exports` → `src/*.ts` and `publishConfig.exports` →
  `dist/*.js` + `dist/*.d.ts`. Adding an entry point means updating **both**.
- **Pinned deps, do not bump:** `flydrive` stays `^1`, `@types/node` stays `^22`, `typescript` stays
  `^6`.
- **Repository backends must pass the shared contract** at
  `packages/core/src/testing/repository-contract.ts`. Adding a repository capability means adding its
  cases there, never writing parallel per-backend tests.
- **Docs must match shipped behavior.** A README/spec/JSDoc claim that over- or under-states what the
  code does is a defect, not a nitpick.
- **Conventional Commits with a package scope**, minus the `@node-media-library/` prefix — e.g.
  `feat(core): ...`, `fix(prisma): ...`, `chore: ...` for repo-wide.
- **Do NOT run `pnpm changeset`** for any task in this plan. Release notes are hand-folded into the
  existing `## 1.0.0` CHANGELOG sections in Task 10. This is a deliberate decision recorded in spec
  §7.2 — adding changesets would push the first published version to 1.0.1 or 2.0.0.
- **Publishing goes through pnpm only.** `prepack` (`scripts/ensure-pnpm-pack.mjs`) deliberately fails
  under bare `npm publish`/`npm pack`.

---

### Task 1: Widen the Prisma peer range to `>=6 <8`

Implements spec §1.

**Files:**

- Modify: `packages/prisma/package.json:54`
- Modify: `packages/prisma/README.md` (add a compatibility statement)

**Interfaces:**

- Consumes: nothing.
- Produces: nothing consumed by later tasks.

There is no test for this task by explicit decision (spec §1) — CI installs Prisma 7 only, and no
Prisma 6 CI leg is being added. The compatibility statement in the README is what makes that honest.

- [ ] **Step 1: Confirm the adapter really imports nothing from `@prisma/client`**

Run:

```bash
grep -rn "from '" packages/prisma/src | grep -v "\./"
```

Expected: every line resolves to `@node-media-library/core`. No `@prisma/client` anywhere. If this is
not the case, STOP — the whole justification for widening the range is void.

- [ ] **Step 2: Widen the peer range**

In `packages/prisma/package.json`, change the `peerDependencies` entry:

```json
    "@prisma/client": ">=6 <8"
```

Leave `devDependencies["@prisma/client"]` at `^7.9.1` and leave the `peerDependenciesMeta` block
untouched.

- [ ] **Step 3: Add the compatibility statement to the README**

Add this section to `packages/prisma/README.md`, immediately after the installation instructions:

```markdown
## Prisma version compatibility

The peer range is `>=6 <8`. The adapter is structurally typed — it imports nothing from
`@prisma/client` and talks to a `{ media: { findMany, create, ... } }` shape you pass in — so it does
not depend on any one client major.

**CI exercises Prisma 7 only.** Support for Prisma 6 rests on that import-graph property, not on a
passing test suite. If you hit an incompatibility on 6, please open an issue; it will be treated as a
bug in this range, not as unsupported usage.
```

- [ ] **Step 4: Verify the workspace still installs and typechecks**

Run:

```bash
pnpm install --no-frozen-lockfile && pnpm --filter @node-media-library/prisma typecheck
```

Expected: install succeeds with no peer warning, typecheck passes.

- [ ] **Step 5: Verify formatting**

Run:

```bash
pnpm format:check
```

Expected: PASS. (`.prettierignore` excludes `**/package.json`, so only the README is checked.)

- [ ] **Step 6: Commit**

```bash
git add packages/prisma/package.json packages/prisma/README.md pnpm-lock.yaml
git commit -m "fix(prisma): widen the @prisma/client peer range to >=6 <8"
```

---

### Task 2: Generate VERSION from package.json at build time

Implements spec §2.

**Files:**

- Create: `packages/core/scripts/sync-version.mjs`
- Create: `packages/core/src/version.ts` (generated, but committed)
- Create: `packages/core/test/version.test.ts`
- Modify: `packages/core/src/index.ts:1`
- Modify: `packages/core/package.json` (scripts)
- Modify: `package.json` (root `version` script)
- Modify: `.github/workflows/ci.yml`
- Modify: `website/src/content/docs/api/variables/VERSION.md` (regenerated, not hand-edited)

**Interfaces:**

- Consumes: nothing.
- Produces: `export const VERSION: string` from `packages/core/src/version.ts`, re-exported by
  `packages/core/src/index.ts`. No later task depends on it.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/version.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { VERSION } from '../src/index.js'

describe('VERSION', () => {
  it('matches the version in package.json', () => {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const { version } = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
    expect(VERSION).toBe(version)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run:

```bash
pnpm --filter @node-media-library/core test version
```

Expected: FAIL — `expected '0.0.0' to be '1.0.0'`.

- [ ] **Step 3: Write the generator script**

Create `packages/core/scripts/sync-version.mjs`:

```js
// Writes src/version.ts from package.json's version field. Run by `build`,
// `prepublishOnly`, and the root `version` script so the constant can never
// drift from the manifest. CI re-runs it and fails on `git diff --exit-code`.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))

const contents = `// Generated by scripts/sync-version.mjs — do not edit by hand.
export const VERSION = '${version}'
`

writeFileSync(join(pkgDir, 'src', 'version.ts'), contents)
```

- [ ] **Step 4: Wire the script into package.json**

In `packages/core/package.json`, add a `sync-version` script and prepend it to `build`. The `scripts`
block becomes:

```json
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "sync-version": "node scripts/sync-version.mjs",
    "build": "node scripts/sync-version.mjs && tsc -p tsconfig.build.json",
    "docs:api": "typedoc && node scripts/starlight-frontmatter.mjs",
    "prepublishOnly": "pnpm build",
    "prepack": "node ../../scripts/ensure-pnpm-pack.mjs"
  },
```

- [ ] **Step 5: Generate the file and re-point index.ts**

Run:

```bash
pnpm --filter @node-media-library/core sync-version
```

Expected: `packages/core/src/version.ts` now exists containing `export const VERSION = '1.0.0'`.

Then in `packages/core/src/index.ts`, replace line 1:

```ts
export const VERSION = '0.0.0'
```

with:

```ts
export { VERSION } from './version.js'
```

- [ ] **Step 6: Run the test to verify it passes**

Run:

```bash
pnpm --filter @node-media-library/core test version
```

Expected: PASS.

- [ ] **Step 7: Chain the sync into the root `version` script**

In the root `package.json`, change the `version` script from `"changeset version"` to:

```json
    "version": "changeset version && pnpm --filter @node-media-library/core sync-version",
```

Without this, `changeset version` bumps `package.json` and leaves `src/version.ts` stale — the exact
bug this task exists to prevent.

- [ ] **Step 8: Add the CI drift gate**

The unit test from Step 1 **cannot fail in CI** on its own: `.github/workflows/ci.yml` runs
`pnpm -r build` (line 52) before `pnpm -r test` (line 53), so the build regenerates the file before
any test reads it. Add a regenerate-and-diff step, matching the pattern the `api-docs` job already
uses. In `.github/workflows/ci.yml`, insert these two steps immediately after the `pnpm -r build`
line and before `pnpm -r test`:

```yaml
      - run: pnpm --filter @node-media-library/core sync-version
      - name: version.ts is up to date
        run: git diff --exit-code -- packages/core/src/version.ts
```

- [ ] **Step 9: Regenerate the committed API reference**

`website/src/content/docs/api/variables/VERSION.md` renders `"0.0.0"` and the `api-docs` CI job fails
on any diff under `website/src/content/docs/api`.

Run:

```bash
pnpm --filter @node-media-library/core docs:api
```

Expected: `website/src/content/docs/api/variables/VERSION.md` now shows `1.0.0`. Review
`git diff -- website/src/content/docs/api` and confirm nothing unrelated changed.

- [ ] **Step 10: Run the full core suite and format check**

Run:

```bash
pnpm --filter @node-media-library/core test && pnpm format:check
```

Expected: all PASS. `packages/core/test/exports.test.ts` asserts the public export surface — if it
fails, the re-export in Step 5 changed the surface and must be corrected, not the test.

- [ ] **Step 11: Commit**

```bash
git add packages/core/scripts/sync-version.mjs packages/core/src/version.ts \
  packages/core/src/index.ts packages/core/test/version.test.ts \
  packages/core/package.json package.json .github/workflows/ci.yml \
  website/src/content/docs/api
git commit -m "fix(core): generate VERSION from package.json instead of hardcoding 0.0.0"
```

---

### Task 3: Add `loadSharp()` with two distinct failure messages

Implements the helper half of spec §3. Task 4 depends on this.

**Files:**

- Create: `packages/core/src/conversions/load-sharp.ts`
- Create: `packages/core/test/load-sharp.test.ts`
- Modify: `packages/core/src/conversions/image-generator.ts:35`
- Modify: `packages/core/src/responsive/generator.ts:15` and `:31`
- Modify: `packages/core/src/conversions/engine.ts:149`

**Interfaces:**

- Consumes: `MediaLibraryError` from `packages/core/src/errors.js`.
- Produces: `loadSharp(importer?: () => Promise<{ default: Sharp }>): Promise<Sharp>` from
  `packages/core/src/conversions/load-sharp.js`. Task 4 relies on this existing at all four former
  `await import('sharp')` sites. The optional `importer` parameter exists solely so the failure paths
  are testable without module mocking; production callers pass nothing.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/load-sharp.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { loadSharp } from '../src/conversions/load-sharp.js'
import { MediaLibraryError } from '../src/errors.js'

function throwingImporter(message: string, code: string): () => Promise<never> {
  return () => {
    const err = new Error(message) as Error & { code: string }
    err.code = code
    return Promise.reject(err)
  }
}

describe('loadSharp', () => {
  it('returns the sharp module when it is installed', async () => {
    const sharp = await loadSharp()
    expect(typeof sharp).toBe('function')
  })

  it('tells you to install sharp when the module is absent', async () => {
    const importer = throwingImporter("Cannot find package 'sharp'", 'ERR_MODULE_NOT_FOUND')
    await expect(loadSharp(importer)).rejects.toThrow(MediaLibraryError)
    await expect(loadSharp(importer)).rejects.toThrow(/optional peer dependency/)
    await expect(loadSharp(importer)).rejects.toThrow(/imageGenerators/)
  })

  it('distinguishes an unloadable native binary from an absent module', async () => {
    const importer = throwingImporter(
      'Could not load the sharp module using the darwin-arm64 runtime',
      'ERR_DLOPEN_FAILED',
    )
    await expect(loadSharp(importer)).rejects.toThrow(MediaLibraryError)
    await expect(loadSharp(importer)).rejects.toThrow(/could not be loaded on this platform/)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run:

```bash
pnpm --filter @node-media-library/core test load-sharp
```

Expected: FAIL — cannot resolve `../src/conversions/load-sharp.js`.

- [ ] **Step 3: Write the helper**

Create `packages/core/src/conversions/load-sharp.ts`:

```ts
import { MediaLibraryError } from '../errors.js'

type Sharp = typeof import('sharp').default

/**
 * Loads sharp, which is an OPTIONAL peer dependency — core never installs it,
 * and no package manager auto-installs a peer marked optional.
 *
 * Two failures need two messages. "Not installed" is the common case. "Present
 * but its native binary will not load" becomes more likely once sharp resolves
 * separately from core rather than hoisted alongside it, and the fix is
 * different, so conflating them would send the reader down the wrong path.
 *
 * `importer` exists only so both failure branches are testable without module
 * mocking. Production callers pass nothing.
 */
export async function loadSharp(
  importer: () => Promise<{ default: Sharp }> = () => import('sharp'),
): Promise<Sharp> {
  try {
    return (await importer()).default
  } catch (e) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : ''
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      throw new MediaLibraryError(
        'sharp is not installed. It is an optional peer dependency of @node-media-library/core, ' +
          'needed for image conversions and responsive images. Install it (`pnpm add sharp`), or ' +
          'supply your own generators via config.imageGenerators.',
      )
    }
    const message = e instanceof Error ? e.message : String(e)
    throw new MediaLibraryError(
      `sharp is installed but could not be loaded on this platform: ${message}. Reinstall it for ` +
        'this OS and architecture (`pnpm rebuild sharp`), or supply your own generators via ' +
        'config.imageGenerators.',
    )
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @node-media-library/core test load-sharp
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Route all four production call sites through the helper**

In `packages/core/src/conversions/image-generator.ts`, add the import at the top:

```ts
import { loadSharp } from './load-sharp.js'
```

and replace line 35:

```ts
      const sharp = (await import('sharp')).default
```

with:

```ts
      const sharp = await loadSharp()
```

In `packages/core/src/responsive/generator.ts`, add:

```ts
import { loadSharp } from '../conversions/load-sharp.js'
```

and replace **both** occurrences (lines 15 and 31) of:

```ts
  const sharp = (await import('sharp')).default
```

with:

```ts
  const sharp = await loadSharp()
```

In `packages/core/src/conversions/engine.ts`, add:

```ts
import { loadSharp } from './load-sharp.js'
```

and replace line 149:

```ts
    const sharp = (await import('sharp')).default
```

with:

```ts
    const sharp = await loadSharp()
```

- [ ] **Step 6: Verify no direct sharp imports remain in production source**

Run:

```bash
grep -rn "import('sharp')\|from 'sharp'" packages/core/src
```

Expected: exactly two lines, both in `load-sharp.ts` — the `type Sharp = typeof import('sharp').default`
line and the default `importer`. `packages/core/src/testing/storage-contract.ts` will still show a
static import; that one is handled in Task 4.

- [ ] **Step 7: Run the full core suite**

Run:

```bash
pnpm --filter @node-media-library/core test
```

Expected: PASS. The conversion and responsive-image suites exercise the rewired call sites for real.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/conversions/load-sharp.ts packages/core/test/load-sharp.test.ts \
  packages/core/src/conversions/image-generator.ts packages/core/src/responsive/generator.ts \
  packages/core/src/conversions/engine.ts
git commit -m "refactor(core): route sharp imports through loadSharp with actionable errors"
```

---

### Task 4: Move sharp to an optional peer of core, pdf, and video

Implements the manifest and docs half of spec §3. Requires Task 3.

**Files:**

- Modify: `packages/core/package.json` (dependencies → peerDependencies + devDependencies)
- Modify: `packages/pdf/package.json` (add peerDependencies + peerDependenciesMeta)
- Modify: `packages/video/package.json` (add peerDependencies + peerDependenciesMeta)
- Modify: `packages/core/src/testing/storage-contract.ts:2` (static import → dynamic)
- Modify: `packages/core/README.md` (installation, `imageGenerators` config row)
- Modify: `packages/pdf/README.md`, `packages/video/README.md` (installation)

**Interfaces:**

- Consumes: `loadSharp()` from Task 3 — the error message it produces is what makes the optional peer
  survivable.
- Produces: nothing consumed by later tasks.

**Why the range is `>=0.33 <1` and not `^0.35.3`:** sharp is pre-1.0, so a caret range means
`>=0.35.3 <0.36.0` — narrow enough to force a core release on every sharp minor and to generate peer
warnings for consumers within months. The operations used (`resize`, `rotate`, `greyscale`, `blur`,
`sharpen`, format encoders) have been stable since 0.33.

- [ ] **Step 1: Move sharp in the core manifest**

In `packages/core/package.json`:

Remove `"sharp": "^0.35.3"` from `dependencies`, leaving:

```json
  "dependencies": { "archiver": "^8.0.0", "file-type": "^22.0.1", "flydrive": "^1.3.0" },
```

Add sharp to `peerDependencies` and `peerDependenciesMeta`, alongside the existing optional peers:

```json
  "peerDependencies": {
    "@google-cloud/storage": "^7.10.2",
    "@aws-sdk/client-s3": "^3.577.0",
    "@aws-sdk/s3-request-presigner": "^3.577.0",
    "sharp": ">=0.33 <1"
  },
  "peerDependenciesMeta": {
    "@google-cloud/storage": { "optional": true },
    "@aws-sdk/client-s3": { "optional": true },
    "@aws-sdk/s3-request-presigner": { "optional": true },
    "sharp": { "optional": true }
  },
```

Add `"sharp": "^0.35.3"` to `devDependencies` so this repo's own suites still run — the same pattern
`@aws-sdk/client-s3` already follows (it appears in both peer and dev).

Keep the file's hand-formatted compact style; `.prettierignore` excludes `**/package.json`.

- [ ] **Step 2: Add the peer to pdf and video**

Both packages import and call `sharpImageGenerator()` from core (`packages/pdf/src/generator.ts:2`
and `:22`, `packages/video/src/generator.ts:2` and `:19`) — they rasterize a PDF page or video frame
_into_ it, so sharp is a hard runtime requirement. They currently get it transitively through core's
`dependencies` and list it in `devDependencies` only.

In **both** `packages/pdf/package.json` and `packages/video/package.json`, add sharp to the existing
`peerDependencies` and `peerDependenciesMeta` blocks:

```json
    "sharp": ">=0.33 <1"
```

```json
    "sharp": { "optional": true }
```

Leave their existing `devDependencies["sharp"]` at `^0.35.3`.

- [ ] **Step 3: Make the testing entry point's sharp import dynamic**

`packages/core/src/testing/storage-contract.ts:2` has `import sharp from 'sharp'`, and `./testing` is
a published entry point — a consumer running the storage contract against their own disk should not
need an image library.

Find every use:

```bash
grep -n "sharp" packages/core/src/testing/storage-contract.ts
```

Delete the static import on line 2, and at the top of each function body that uses `sharp`, add:

```ts
  const sharp = (await import('sharp')).default
```

Use a raw dynamic import here, **not** `loadSharp()` — this is test-support code where a missing
module should surface as a plain resolution error, not be dressed up as a library configuration
problem.

- [ ] **Step 4: Verify the workspace still installs and the suites pass**

Run:

```bash
pnpm install --no-frozen-lockfile && pnpm -r typecheck && pnpm -r test
```

Expected: all PASS. sharp is still present via `devDependencies`, so nothing in-repo loses it. Local
skips for `pdftoppm`/`ffmpeg`/`jpegoptim`/`pngquant`/`REDIS_URL`/`AMQP_URL` are expected — CI is the
authority on those.

- [ ] **Step 5: Update the core README**

`packages/core/README.md:17` says `pnpm add @node-media-library/core`, and the Quick Start
immediately below configures a `.nonQueued()` conversion (`:54`) that runs inline on the first
`add()`. A reader copying it verbatim would now hit `loadSharp()`'s error on their first upload.

Change the install line to:

```bash
pnpm add @node-media-library/core sharp
```

and add this callout directly beneath it, mirroring the existing optional-peer block for the AWS SDK
at `README.md:378`:

```markdown
> **sharp is an optional peer dependency.** It is required for image conversions, responsive images,
> and placeholders — which the Quick Start below uses. Omit it only if you store files without ever
> converting them, or if you supply your own `config.imageGenerators`. Nothing auto-installs it: npm
> and pnpm both skip peers marked optional, and Yarn never auto-installs peers at all.
```

Then find the `imageGenerators` row in the configuration table (around `README.md:94`) and append to
its description:

```
Defaults to `[sharpImageGenerator()]`, which needs the optional `sharp` peer.
```

- [ ] **Step 6: Update the pdf and video READMEs**

In both `packages/pdf/README.md` and `packages/video/README.md`, change the install command to
include sharp and add:

```markdown
> **sharp is a required optional peer.** This package rasterizes into core's `sharpImageGenerator()`,
> so sharp must be installed even though it is declared optional. It is marked optional only because
> core declares it that way.
```

- [ ] **Step 7: Verify formatting**

Run:

```bash
pnpm format:check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/package.json packages/pdf/package.json packages/video/package.json \
  packages/core/src/testing/storage-contract.ts packages/core/README.md \
  packages/pdf/README.md packages/video/README.md pnpm-lock.yaml
git commit -m "feat(core,pdf,video)!: make sharp an optional peer dependency"
```

---

### Task 5: Add `customProperties` to `MediaFilter` (core + in-memory + contract)

Implements the core half of spec §4. Task 6 depends on this.

**Files:**

- Create: `packages/core/src/repository/match.ts`
- Modify: `packages/core/src/repository.ts:3-6`
- Modify: `packages/core/src/repository/in-memory.ts:93-105`
- Modify: `packages/core/src/testing/repository-contract.ts` (new cases after the
  `iterateAll honors filters` block, which ends at line 168)
- Modify: `packages/core/src/index.ts` (export the new helper)

**Interfaces:**

- Consumes: `MediaRecord` from `../types.js`, `MediaFilter` from `../repository.js`.
- Produces:
  - `MediaFilter.customProperties?: JsonObject` — Task 6's Prisma adapter must honor this.
  - `matchesMediaFilter(record: MediaRecord, filter?: MediaFilter): boolean`, exported from
    `@node-media-library/core`. Task 6 imports this by that exact name for its post-filter path.

**Why this is breaking-if-deferred:** adding an optional field to `MediaFilter` is type-level
additive, so third-party `MediaRepository` implementations keep compiling — but they will _ignore_
the field and silently return **unfiltered** results. The motivating use case is a deletion path, so
a backend that silently over-matches deletes another tenant's media: no compile error, no runtime
error, wrong data. Exporting `matchesMediaFilter` gives third-party authors a correct implementation
to call, which is the only available mitigation.

- [ ] **Step 1: Write the failing contract cases**

In `packages/core/src/testing/repository-contract.ts`, add these two cases immediately after the
existing `it('iterateAll honors filters', ...)` block:

```ts
    it('iterateAll filters by customProperties with AND across keys', async () => {
      await repo.create(makeRecord({ customProperties: { storeId: 's1', kind: 'photo' } }))
      await repo.create(makeRecord({ customProperties: { storeId: 's1', kind: 'label' } }))
      await repo.create(makeRecord({ customProperties: { storeId: 's2', kind: 'photo' } }))
      await repo.create(makeRecord({ customProperties: {} }))

      const store1: string[] = []
      for await (const record of repo.iterateAll({ customProperties: { storeId: 's1' } })) {
        expect(record.customProperties.storeId).toBe('s1')
        store1.push(record.id)
      }
      expect(store1.length).toBe(2)

      const store1Photos: string[] = []
      for await (const record of repo.iterateAll({
        customProperties: { storeId: 's1', kind: 'photo' },
      })) {
        store1Photos.push(record.id)
      }
      expect(store1Photos.length).toBe(1)

      // A record missing the key does not match.
      const missingKey: string[] = []
      for await (const record of repo.iterateAll({ customProperties: { storeId: 's9' } })) {
        missingKey.push(record.id)
      }
      expect(missingKey.length).toBe(0)

      // An empty filter object matches everything, preserving prior behavior.
      const everything: string[] = []
      for await (const record of repo.iterateAll({ customProperties: {} })) {
        everything.push(record.id)
      }
      expect(everything.length).toBe(4)

      // Composes with the pre-existing filters.
      const combined: string[] = []
      for await (const record of repo.iterateAll({
        modelType: 'User',
        customProperties: { storeId: 's1' },
      })) {
        combined.push(record.id)
      }
      expect(combined.length).toBe(2)
    })

    it('iterateAll compares customProperties values by deep equality', async () => {
      await repo.create(makeRecord({ customProperties: { tags: ['a', 'b'], meta: { x: 1 } } }))
      await repo.create(makeRecord({ customProperties: { tags: ['a'], meta: { x: 2 } } }))

      const nestedArray: string[] = []
      for await (const record of repo.iterateAll({ customProperties: { tags: ['a', 'b'] } })) {
        nestedArray.push(record.id)
      }
      expect(nestedArray.length).toBe(1)

      const nestedObject: string[] = []
      for await (const record of repo.iterateAll({ customProperties: { meta: { x: 1 } } })) {
        nestedObject.push(record.id)
      }
      expect(nestedObject.length).toBe(1)

      // Order matters for arrays; a different order is a different JSON value.
      const reordered: string[] = []
      for await (const record of repo.iterateAll({ customProperties: { tags: ['b', 'a'] } })) {
        reordered.push(record.id)
      }
      expect(reordered.length).toBe(0)
    })
```

Note `makeRecord` defaults `modelType` to `'User'` (line 12 of that file), which is why the
`combined` assertion expects 2.

- [ ] **Step 2: Run it to make sure it fails**

Run:

```bash
pnpm --filter @node-media-library/core test in-memory-repository
```

Expected: FAIL — TypeScript rejects `customProperties` as an unknown property of `MediaFilter`.

- [ ] **Step 3: Add the field to the interface**

In `packages/core/src/repository.ts`, replace lines 3-6:

```ts
export interface MediaFilter {
  modelType?: string
  collectionName?: string
}
```

with:

```ts
export interface MediaFilter {
  modelType?: string
  collectionName?: string
  /**
   * Every key must deep-equal the record's corresponding `customProperties`
   * value. AND across keys; a record missing the key does not match; an
   * absent or empty object matches everything.
   *
   * Backends implementing this by hand should call `matchesMediaFilter` so
   * their semantics match the shared contract exactly. A backend that ignores
   * this field returns UNFILTERED results, which is dangerous on deletion
   * paths.
   */
  customProperties?: JsonObject
}
```

`JsonObject` is already imported on line 1 of that file.

- [ ] **Step 4: Write the shared matcher**

Create `packages/core/src/repository/match.ts`:

```ts
import type { MediaFilter } from '../repository.js'
import type { MediaRecord } from '../types.js'

/**
 * Deep structural equality for JSON values. `customProperties` values may be
 * nested objects or arrays, and `===` never matches those — without this the
 * in-memory and SQL backends would silently disagree.
 */
function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false

  const aIsArray = Array.isArray(a)
  if (aIsArray !== Array.isArray(b)) return false
  if (aIsArray) {
    const av = a as unknown[]
    const bv = b as unknown[]
    return av.length === bv.length && av.every((item, i) => jsonEquals(item, bv[i]))
  }

  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const aKeys = Object.keys(ao)
  if (aKeys.length !== Object.keys(bo).length) return false
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(bo, key) && jsonEquals(ao[key], bo[key]),
  )
}

/**
 * Whether `record` satisfies `filter`.
 *
 * Exported so third-party `MediaRepository` backends can implement
 * `iterateAll` filtering with the exact semantics
 * `runMediaRepositoryContract` asserts, rather than reimplementing them and
 * diverging.
 */
export function matchesMediaFilter(record: MediaRecord, filter?: MediaFilter): boolean {
  if (!filter) return true
  if (filter.modelType !== undefined && record.modelType !== filter.modelType) return false
  if (filter.collectionName !== undefined && record.collectionName !== filter.collectionName) {
    return false
  }
  if (filter.customProperties !== undefined) {
    for (const [key, value] of Object.entries(filter.customProperties)) {
      if (!Object.prototype.hasOwnProperty.call(record.customProperties, key)) return false
      if (!jsonEquals(record.customProperties[key], value)) return false
    }
  }
  return true
}
```

- [ ] **Step 5: Use it in the in-memory backend**

In `packages/core/src/repository/in-memory.ts`, add to the imports:

```ts
import { matchesMediaFilter } from './match.js'
```

and replace the `iterateAll` body (lines 93-105) with:

```ts
  async *iterateAll(filter?: MediaFilter): AsyncIterable<MediaRecord> {
    const matches = [...this.records.values()]
      .filter((record) => matchesMediaFilter(record, filter))
      .sort(compareMediaOrder)
    for (const record of matches) {
      yield record
    }
  }
```

- [ ] **Step 6: Export the helper from the package root**

In `packages/core/src/index.ts`, add alongside the other repository exports:

```ts
export { matchesMediaFilter } from './repository/match.js'
```

- [ ] **Step 7: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @node-media-library/core test
```

Expected: PASS, including the two new contract cases via `in-memory-repository.test.ts`.
`packages/core/test/exports.test.ts` asserts the public surface — if it fails, add
`matchesMediaFilter` to its expected list; the export is intentional.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/repository.ts packages/core/src/repository/match.ts \
  packages/core/src/repository/in-memory.ts packages/core/src/index.ts \
  packages/core/src/testing/repository-contract.ts
git commit -m "feat(core): filter iterateAll by customProperties with deep equality"
```

---

### Task 6: Prisma adapter — portable post-filter with opt-in `jsonPathStyle` push-down

Implements the Prisma half of spec §4. Requires Task 5.

**Files:**

- Modify: `packages/prisma/src/adapter.ts:1` (import), `:12-15` (options), `:123-147` (`iterateAll`)
- Create: `packages/prisma/test/json-path-style.test.ts`
- Modify: `packages/prisma/README.md`

**Interfaces:**

- Consumes: `MediaFilter` and `matchesMediaFilter` from `@node-media-library/core` (Task 5).
- Produces: `PrismaAdapterOptions.jsonPathStyle?: 'postgres' | 'mysql'`.

**Why there is no single portable implementation.** Prisma's JSON `path` operand is connector-shaped:
PostgreSQL takes `path: ['storeId']`, MySQL and SQLite take `path: '$.storeId'`. A probe against this
repo's SQLite test database confirmed the `$.storeId` form works and the array form throws
`PrismaClientValidationError`. The adapter has no provider knowledge and `client.ts:30` types
`findMany(args?: Record<string, unknown>)`, so TypeScript cannot catch a mismatch — an implementation
written to pass the contract on SQLite would throw at runtime on PostgreSQL. Hence: post-filter by
default, push-down only when the consumer names their dialect.

- [ ] **Step 1: Write the failing test for the push-down path**

Create `packages/prisma/test/json-path-style.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { prismaAdapter } from '../src/adapter.js'
import { getTestClient } from './helpers/client.js'

function makeRecord(over: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    uuid: crypto.randomUUID(),
    modelType: 'User',
    modelId: 'u1',
    collectionName: 'default',
    fileName: 'a.jpg',
    name: 'a',
    disk: 'default',
    size: 1,
    manipulations: {},
    customProperties: {},
    generatedConversions: {},
    responsiveImages: {},
    orderColumn: null,
    mimeType: 'image/jpeg',
    conversionsDisk: null,
    ...over,
  }
}

describe("jsonPathStyle: 'mysql' pushes customProperties into SQL", () => {
  beforeEach(async () => {
    const client = await getTestClient()
    await client.media.deleteMany({})
  })

  it('returns the same rows as the portable default', async () => {
    const client = await getTestClient()
    const pushDown = prismaAdapter(client, { jsonPathStyle: 'mysql' })
    const portable = prismaAdapter(client)

    await pushDown.create(makeRecord({ customProperties: { storeId: 's1' } }))
    await pushDown.create(makeRecord({ customProperties: { storeId: 's1' } }))
    await pushDown.create(makeRecord({ customProperties: { storeId: 's2' } }))

    const pushed: string[] = []
    for await (const record of pushDown.iterateAll({ customProperties: { storeId: 's1' } })) {
      pushed.push(record.id)
    }

    const scanned: string[] = []
    for await (const record of portable.iterateAll({ customProperties: { storeId: 's1' } })) {
      scanned.push(record.id)
    }

    expect(pushed.length).toBe(2)
    expect(pushed.sort()).toEqual(scanned.sort())
  })

  it('combines the pushed-down filter with modelType', async () => {
    const client = await getTestClient()
    const repo = prismaAdapter(client, { jsonPathStyle: 'mysql' })

    await repo.create(makeRecord({ modelType: 'User', customProperties: { storeId: 's1' } }))
    await repo.create(makeRecord({ modelType: 'Post', customProperties: { storeId: 's1' } }))

    const found: string[] = []
    for await (const record of repo.iterateAll({
      modelType: 'User',
      customProperties: { storeId: 's1' },
    })) {
      found.push(record.id)
    }
    expect(found.length).toBe(1)
  })
})
```

`'mysql'` is the style testable here — the SQLite test database accepts the `$.key` form. The
`'postgres'` array form cannot be exercised by this repo's suite; that limitation is documented in
Step 6, not papered over.

- [ ] **Step 2: Run it to make sure it fails**

Run:

```bash
pnpm --filter @node-media-library/prisma test json-path-style
```

Expected: FAIL — TypeScript rejects `jsonPathStyle` as an unknown option.

- [ ] **Step 3: Add the option**

In `packages/prisma/src/adapter.ts`, replace the `PrismaAdapterOptions` interface (lines 12-15):

```ts
export interface PrismaAdapterOptions {
  owners?: Record<string, (modelId: string) => boolean | Promise<boolean>>
  iterateBatchSize?: number
  /**
   * Push `MediaFilter.customProperties` into the SQL `where` clause using this
   * database's JSON path syntax. PostgreSQL takes an array path
   * (`['storeId']`); MySQL and SQLite take a string path (`'$.storeId'`).
   * Prisma does not normalize the two, and this adapter is structurally typed
   * — it never imports `@prisma/client` and cannot detect your provider — so
   * naming the dialect is your call.
   *
   * Omit it to filter in the application instead. That is correct on every
   * provider, but it reads every row matching `modelType`/`collectionName`
   * before discarding non-matches.
   *
   * Setting the wrong dialect surfaces as a `PrismaClientValidationError` on
   * the first filtered `iterateAll`, not as a type error.
   */
  jsonPathStyle?: 'postgres' | 'mysql'
}
```

- [ ] **Step 4: Implement both paths in `iterateAll`**

In `packages/prisma/src/adapter.ts`, add `matchesMediaFilter` to the value import on line 1:

```ts
import { MediaLibraryError, matchesMediaFilter } from '@node-media-library/core'
```

Then replace the `iterateAll` method (lines 123-147) with:

```ts
  async *iterateAll(filter?: MediaFilter): AsyncIterable<MediaRecord> {
    const filterWhere: Record<string, unknown> = {}
    if (filter?.modelType !== undefined) filterWhere.modelType = filter.modelType
    if (filter?.collectionName !== undefined) filterWhere.collectionName = filter.collectionName

    // customProperties reaches SQL only when the consumer named their dialect
    // (see PrismaAdapterOptions.jsonPathStyle). Otherwise it is applied per
    // row below — slower, but correct on every provider.
    const style = this.opts.jsonPathStyle
    const entries = filter?.customProperties ? Object.entries(filter.customProperties) : []
    const pushedDown = style !== undefined && entries.length > 0
    if (pushedDown) {
      filterWhere.AND = entries.map(([key, value]) => ({
        customProperties: {
          path: style === 'postgres' ? [key] : `$.${key}`,
          equals: value,
        },
      }))
    }

    // Keyset pagination on id (not cursor+skip): a row can be deleted between
    // batches (e.g. Plan 6's clean command iterates and deletes concurrently),
    // and cursor+skip would silently truncate if the cursor row itself is gone.
    // `id > lastId` needs no row to still exist, only the last-seen id value.
    let lastId: string | undefined
    for (;;) {
      const where = lastId !== undefined ? { ...filterWhere, id: { gt: lastId } } : filterWhere
      const rows = await this.client.media.findMany({
        where,
        orderBy: { id: 'asc' as const },
        take: this.batchSize,
      })
      if (rows.length === 0) return
      for (const row of rows) {
        const record = toMediaRecord(row)
        // Batch termination below counts rows FETCHED, not yielded, so
        // post-filtering here cannot truncate the iteration early.
        if (pushedDown || matchesMediaFilter(record, filter)) {
          yield record
        }
      }
      lastId = rows[rows.length - 1]!.id
      if (rows.length < this.batchSize) return
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @node-media-library/prisma test
```

Expected: PASS — the new `json-path-style` tests plus `contract.test.ts`, which now exercises the
portable default path against SQLite with Task 5's new contract cases.

- [ ] **Step 6: Document both paths honestly in the Prisma README**

Add this section to `packages/prisma/README.md`:

````markdown
## Filtering by `customProperties`

`iterateAll({ customProperties: { storeId: 's1' } })` matches records whose `customProperties`
contain every supplied key with a deep-equal value.

**By default the filter runs in the application, not the database.** The adapter pushes
`modelType`/`collectionName` down to their indexed columns, then discards non-matching rows in Node.
Correct everywhere, but it reads every row matching the other filters.

To push it into SQL, name your database's JSON path dialect:

```ts
prismaAdapter(client, { jsonPathStyle: 'postgres' }) // or 'mysql'
```

Prisma's JSON `path` operand differs per connector — PostgreSQL takes an array (`['storeId']`), MySQL
and SQLite take a string (`'$.storeId'`) — and this adapter never imports `@prisma/client`, so it
cannot detect your provider. Naming the wrong one surfaces as a `PrismaClientValidationError` on the
first filtered call, not as a type error.

**Even pushed down, JSON matching is unindexed by default.** On PostgreSQL, add an expression index
for the key you filter on:

```sql
CREATE INDEX media_store_id_idx ON "Media" ((("customProperties" ->> 'storeId')));
```

**What CI exercises:** the portable default path and `jsonPathStyle: 'mysql'`, both against SQLite.
The `'postgres'` array form is asserted from Prisma's documented behavior, not from a passing test.
````

- [ ] **Step 7: Verify formatting**

Run:

```bash
pnpm format:check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/prisma/src/adapter.ts packages/prisma/test/json-path-style.test.ts \
  packages/prisma/README.md
git commit -m "feat(prisma): filter iterateAll by customProperties, with opt-in SQL push-down"
```

---

### Task 7: Add `MEDIA_FS_BASE_URL` and document the no-S3 dev loop

Implements spec §5 and the `PathGenerator` caveat from the spec's scope-boundary section.

**Files:**

- Modify: `packages/core/src/storage/resolve.ts:150-154`
- Modify: `packages/core/test/storage-resolve.test.ts`
- Modify: `packages/core/README.md`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/storage-resolve.test.ts`, inside the existing `describe('resolveStorage')`
block:

```ts
  it('reads MEDIA_FS_BASE_URL into the fs disk baseUrl', () => {
    const s = resolveStorage(undefined, {
      MEDIA_FS_ROOT: '/tmp/media',
      MEDIA_FS_BASE_URL: 'http://localhost:3000/media',
    })
    expect(s.diskConfig()).toMatchObject({
      driver: 'fs',
      root: '/tmp/media',
      baseUrl: 'http://localhost:3000/media',
    })
  })

  it('omits baseUrl entirely when MEDIA_FS_BASE_URL is unset', () => {
    const s = resolveStorage(undefined, { MEDIA_FS_ROOT: '/tmp/media' })
    expect(s.diskConfig()).not.toHaveProperty('baseUrl')
  })
```

- [ ] **Step 2: Run it to make sure it fails**

Run:

```bash
pnpm --filter @node-media-library/core test storage-resolve
```

Expected: FAIL — the resolved config has no `baseUrl` key.

- [ ] **Step 3: Read the env var in the fs branch**

In `packages/core/src/storage/resolve.ts`, replace the fs fallback return (lines 150-154):

```ts
  return {
    driver: 'fs',
    root: env.MEDIA_FS_ROOT ?? './storage/media',
    visibility: 'private',
  }
```

with:

```ts
  return {
    driver: 'fs',
    root: env.MEDIA_FS_ROOT ?? './storage/media',
    visibility: 'private',
    ...(env.MEDIA_FS_BASE_URL ? { baseUrl: env.MEDIA_FS_BASE_URL } : {}),
  }
```

This mirrors the r2 branch at line 127 exactly. No change to `url-generator.ts` is needed —
`publicUrlFor` (`storage/url-generator.ts:105-112`) already short-circuits on `config.baseUrl` for
any driver before reaching `disk.getUrl()`.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @node-media-library/core test storage-resolve
```

Expected: PASS.

- [ ] **Step 5: Document both dev-loop options, with the security caveat**

Add this section to `packages/core/README.md`, in the storage/configuration area near the other
`MEDIA_*` env vars:

````markdown
### Seeing your files in development (no S3)

With the local filesystem disk, `url()` throws unless the disk has a `baseUrl` — there is nothing to
build a URL from. Two ways forward, and the second is recommended.

**Preferred: serve through your own route.** `download()` and `inline()` return a Web `Response`, so
in any Fetch-based framework this is the whole integration:

```ts
export async function loader({ params }) {
  return library.inline(params.id)
}
```

Authorization stays in your handler, where it belongs.

**Alternative: set a base URL and serve the root statically.**

```bash
MEDIA_FS_ROOT=./storage/media
MEDIA_FS_BASE_URL=http://localhost:3000/media
```

> **This bypasses private-by-default.** The env-synthesized fs disk is `visibility: 'private'`, but
> statically serving `MEDIA_FS_ROOT` exposes **every file under that root**, including media in
> private collections. For `r2` the library refuses to construct in the equivalent situation; there
> is no such guard for `fs`. Use this for local development only.

You will also see the `[media-library] Media is stored on the local filesystem in production`
warning if `NODE_ENV=production` — that is expected with an env-synthesized fs disk, not a bug.
````

- [ ] **Step 6: Document the `PathGenerator` upload-time caveat**

A custom `PathGenerator` is the supported way to control layout (e.g. `stores/<storeId>/…`), but the
record it receives at upload time is incomplete. Find the `pathGenerator` documentation in
`packages/core/README.md` and add:

```markdown
> At upload time `PathGenerator.path()` receives a record that has not been persisted yet — its
> `createdAt` and `updatedAt` are not set. A layout derived from those dates breaks on the first
> upload. `customProperties` **is** populated by then, so keying the layout off a custom property
> works.
```

- [ ] **Step 7: Run the core suite and format check**

Run:

```bash
pnpm --filter @node-media-library/core test && pnpm format:check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/storage/resolve.ts packages/core/test/storage-resolve.test.ts \
  packages/core/README.md
git commit -m "feat(core): read MEDIA_FS_BASE_URL for the fs fallback disk"
```

---

### Task 8: Guard `performConversions()` and document the host-owned-queue recipe

Implements spec §6.

**Files:**

- Modify: `packages/core/src/library.ts:203-206`
- Create: `packages/core/test/perform-conversions-guard.test.ts`
- Modify: `packages/core/docs/writing-a-queue-driver.md`

**Interfaces:**

- Consumes: `assertConversionJob` (module-private, `packages/core/src/library.ts:70`) and
  `ConversionJob` from `./queue.js` — both already in scope in `library.ts`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/perform-conversions-guard.test.ts`. The `makeLibrary` helper mirrors
`packages/core/test/library.test.ts:10-23` — note `storage` wraps `disks`; a bare `disks` key is
rejected:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { MediaLibraryError } from '../src/errors.js'

function makeLibrary() {
  const root = mkdtempSync(join(tmpdir(), 'ml-guard-'))
  return createMediaLibrary({
    repository: new InMemoryMediaRepository(),
    storage: { disks: { default: { driver: 'fs', root } } },
    models: {},
  })
}

describe('performConversions argument validation', () => {
  it('rejects a non-string mediaId before reaching the engine', async () => {
    const library = makeLibrary()
    await expect(library.performConversions(undefined as unknown as string)).rejects.toThrow(
      MediaLibraryError,
    )
    await expect(library.performConversions(undefined as unknown as string)).rejects.toThrow(
      /"mediaId" must be a string/,
    )
  })

  it('rejects conversionNames that is not an array of strings', async () => {
    const library = makeLibrary()
    await expect(
      library.performConversions('some-id', [1, 2] as unknown as string[]),
    ).rejects.toThrow(/"conversionNames" must be absent or an array of strings/)
  })

  it('accepts an absent conversionNames', async () => {
    const library = makeLibrary()
    // The id does not exist, and the engine resolves silently for missing
    // media — so reaching that no-op proves validation let it through.
    await expect(library.performConversions('missing-id')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run:

```bash
pnpm --filter @node-media-library/core test perform-conversions-guard
```

Expected: FAIL — no error is thrown; the engine is reached with a bad `mediaId`.

- [ ] **Step 3: Apply the existing guard**

In `packages/core/src/library.ts`, replace `performConversions` (lines 203-206):

```ts
  /** Runs `names` (or all applicable) conversions for `mediaId` inline. */
  async performConversions(mediaId: string, names?: string[]): Promise<void> {
    return this.engine.perform(mediaId, names)
  }
```

with:

```ts
  /**
   * Runs `names` (or all applicable) conversions for `mediaId` inline.
   *
   * Arguments are shape-checked with the same guard `startWorker()` applies to
   * broker payloads. This is the entry point a host-owned queue bridge calls
   * with a payload it just deserialized, so it must not be the laxer of the
   * two paths — see "Adopting the host application's queue" in
   * docs/writing-a-queue-driver.md.
   */
  async performConversions(mediaId: string, names?: string[]): Promise<void> {
    assertConversionJob({ mediaId, conversionNames: names } as ConversionJob)
    return this.engine.perform(mediaId, names)
  }
```

Reusing `assertConversionJob` rather than writing a second validator keeps both paths on identical
error messages.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @node-media-library/core test perform-conversions-guard
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full core suite**

Run:

```bash
pnpm --filter @node-media-library/core test
```

Expected: PASS. `queue-wiring.test.ts` and `conversion-dispatch.test.ts` call `performConversions`
with real arguments and must be unaffected.

- [ ] **Step 6: Document the host-owned-queue recipe**

Add this section to `packages/core/docs/writing-a-queue-driver.md`, after the existing
`InProcessQueueDriver` vs `BrokerQueueDriver` discussion:

````markdown
## Adopting the host application's queue

If your application already runs a queue — its own broker connection, retry policy, backoff, and
dead-letter path — you do not want a second one. Installing `@node-media-library/bullmq` or
`@node-media-library/rabbitmq` alongside it gives you two of everything.

Bridge instead. Implement `BrokerQueueDriver` so `enqueue` hands the job to your dispatcher, and let
your existing worker call `performConversions()`:

```ts
import type { BrokerQueueDriver, ConversionJob } from '@node-media-library/core'

export function hostQueueDriver(dispatch: (job: ConversionJob) => Promise<void>): BrokerQueueDriver {
  return {
    async enqueue(job) {
      await dispatch(job)
    },
    async work() {
      throw new Error(
        'hostQueueDriver is consumed by the application worker, not by startWorker(). ' +
          'Call library.performConversions(mediaId, names) from your own job handler.',
      )
    },
    async close() {},
  }
}
```

Then in your worker's handler for that job type:

```ts
await library.performConversions(job.mediaId, job.conversionNames)
```

**A `work()` that throws is a legitimate implementation.** `MediaLibrary`'s constructor never calls
`work()` — it only calls `attach()`, and only for in-process drivers. `startWorker()` is the sole
caller, and you are not using it. Nothing else in core reaches this method.

**The driver contract suite does not apply here.** `runBrokerQueueDriverContract` drives a driver
through `work()`, which this one refuses. Assert two things instead: that `enqueue` reaches your
dispatcher, and that your handler round-trips a payload through `performConversions()`.

**Conversion failures will not reach your retry path.** `performConversions()` rejects only when
_every_ requested conversion fails. It resolves when the media record is missing, when no generator
supports the file, and on partial failure — so a job where two of three conversions failed is acked
as successful and your DLQ never sees it. This is exactly how `startWorker()` behaves too; it is not
specific to bridging. Subscribe to the `conversion:failed` event if you need per-conversion failure
visibility.
````

- [ ] **Step 7: Verify formatting**

Run:

```bash
pnpm format:check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/library.ts packages/core/test/perform-conversions-guard.test.ts \
  packages/core/docs/writing-a-queue-driver.md
git commit -m "fix(core): validate performConversions arguments and document host-queue bridging"
```

---

### Task 9: Change `workspace:*` to `workspace:^` in all six adapters

Implements spec §7.1. This must land before the first publish and is free now.

**Files:**

- Modify: `packages/prisma/package.json:51`
- Modify: `packages/bullmq/package.json:50`
- Modify: `packages/rabbitmq/package.json:51`
- Modify: `packages/optimizers/package.json:51`
- Modify: `packages/pdf/package.json:49`
- Modify: `packages/video/package.json:50`

**Interfaces:**

- Consumes: nothing.
- Produces: nothing consumed by later tasks. Task 11's smoke install is what verifies the effect.

**Why:** pnpm rewrites `workspace:*` at pack time to the **exact** version (`"1.0.0"`), not a range.
So `@node-media-library/prisma@1.0.0` would hard-pin `core@1.0.0`, and once core ships 1.0.1 a
consumer gets core 1.0.1 hoisted and core 1.0.0 nested under prisma — two copies in one tree. Since
`packages/prisma/src/adapter.ts:1` imports `MediaLibraryError` as a _value_, errors from the nested
copy fail `instanceof MediaLibraryError` against the hoisted one. `workspace:^` publishes as `^1.0.0`
and dedupes.

- [ ] **Step 1: Confirm the current state**

Run:

```bash
grep -rn "workspace:" packages/*/package.json
```

Expected: six lines, all `"@node-media-library/core": "workspace:*"`.

- [ ] **Step 2: Change all six**

In each of the six files listed above, change:

```json
    "@node-media-library/core": "workspace:*"
```

to:

```json
    "@node-media-library/core": "workspace:^"
```

- [ ] **Step 3: Verify all six changed and none were missed**

Run:

```bash
grep -rn "workspace:" packages/*/package.json
```

Expected: six lines, all `workspace:^`. Zero `workspace:*` remaining.

- [ ] **Step 4: Reinstall and run the full suite**

Run:

```bash
pnpm install --no-frozen-lockfile && pnpm -r typecheck && pnpm -r test
```

Expected: all PASS. `workspace:^` resolves to the local package exactly as `workspace:*` did during
development; the difference appears only at pack time.

- [ ] **Step 5: Commit**

```bash
git add packages/*/package.json pnpm-lock.yaml
git commit -m "fix: publish adapters with a caret range on core instead of an exact pin"
```

---

### Task 10: Fold the release notes into the existing 1.0.0 CHANGELOGs

Implements spec §7.2. Do this only after Tasks 1-9 are merged.

**Files:**

- Modify: every `packages/*/CHANGELOG.md`
- Delete: `.changeset/core-storage-export-surface.md`
- Delete: `.changeset/prisma-schema-and-peer-range.md`

**Interfaces:**

- Consumes: the committed work from Tasks 1-9.
- Produces: CHANGELOGs that describe what actually ships as 1.0.0.

**Why by hand.** `changeset version` already ran at `c60f5ed` — both CHANGELOGs already contain a
written `## 1.0.0` section, and `changeset publish` does not consume changesets. Running
`changeset version` again would yield 1.0.1, or — since `.changeset/config.json` puts all seven
packages in one `fixed` group and Tasks 4 and 5 are breaking — **2.0.0 across all seven as their
first-ever published version**. "Breaking" is meaningless relative to an unpublished state, so
marking these `major` would encode a break against a release nobody can install.

- [ ] **Step 1: Confirm the starting state**

Run:

```bash
head -5 packages/core/CHANGELOG.md && ls .changeset/
```

Expected: a `## 1.0.0` heading in the CHANGELOG, and `.changeset/` containing `README.md`,
`config.json`, `core-storage-export-surface.md`, `prisma-schema-and-peer-range.md`.

- [ ] **Step 2: Read the two pending changesets**

Run:

```bash
cat .changeset/core-storage-export-surface.md .changeset/prisma-schema-and-peer-range.md
```

Their content must survive into the 1.0.0 sections — do not discard it.

- [ ] **Step 3: Fold everything into the `## 1.0.0` sections**

Add the contents of the two pending changesets, plus entries for this plan's work, into each
package's existing `## 1.0.0` section, beneath the existing "First published release" note.

`packages/core/CHANGELOG.md`:

```markdown
- `VERSION` is now generated from `package.json` at build time instead of being hardcoded.
- `sharp` is now an **optional peer dependency** rather than a direct dependency. Install it
  alongside core if you use conversions, responsive images, or placeholders — no package manager
  auto-installs a peer marked optional.
- `MediaFilter` gained `customProperties`, matched by deep equality. `matchesMediaFilter` is exported
  so third-party `MediaRepository` backends can implement it with identical semantics.
- The fs fallback disk reads `MEDIA_FS_BASE_URL`.
- `performConversions()` now validates its arguments with the same guard `startWorker()` applies to
  broker payloads.
```

`packages/prisma/CHANGELOG.md`:

```markdown
- The `@prisma/client` peer range widened to `>=6 <8`. The adapter imports nothing from the client,
  so it is not tied to a single major. CI exercises Prisma 7 only.
- `iterateAll` honors `MediaFilter.customProperties`. It filters in the application by default;
  `jsonPathStyle: 'postgres' | 'mysql'` pushes the filter into SQL.
- The published package now depends on `@node-media-library/core` with a caret range rather than an
  exact pin.
```

`packages/pdf/CHANGELOG.md` and `packages/video/CHANGELOG.md`:

```markdown
- `sharp` is now declared as an optional peer dependency. It is a hard runtime requirement for this
  package — install it explicitly.
- The published package now depends on `@node-media-library/core` with a caret range rather than an
  exact pin.
```

`packages/bullmq/CHANGELOG.md`, `packages/rabbitmq/CHANGELOG.md`, `packages/optimizers/CHANGELOG.md`:

```markdown
- The published package now depends on `@node-media-library/core` with a caret range rather than an
  exact pin.
```

- [ ] **Step 4: Delete the two pending changeset files**

```bash
rm .changeset/core-storage-export-surface.md .changeset/prisma-schema-and-peer-range.md
```

Leave `.changeset/README.md` and `.changeset/config.json` in place — changesets resumes governing
releases at 1.0.1.

- [ ] **Step 5: Verify no version numbers changed**

Run:

```bash
grep -h '"version"' packages/*/package.json && ls .changeset/
```

Expected: every package still at `1.0.0`; `.changeset/` contains only `README.md` and `config.json`.

- [ ] **Step 6: Verify formatting**

Run:

```bash
pnpm format:check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/*/CHANGELOG.md .changeset
git commit -m "chore: fold the pending changesets into the 1.0.0 release notes"
```

---

### Task 11: Add pre-publish verification gates

Implements spec §7.3 and §7.4. This is the last gate before `pnpm release`.

**Files:**

- Create: `scripts/verify-pack.mjs`
- Modify: `package.json` (root scripts, devDependencies)
- Create: `docs/publishing.md`

**Interfaces:**

- Consumes: the manifest changes from Tasks 4 and 9 — this task is what proves they are correct in a
  real tarball.
- Produces: `pnpm verify-pack`, to be run before `pnpm release`.

- [ ] **Step 1: Add the verification tools**

Run:

```bash
pnpm add -Dw publint @arethetypeswrong/cli
```

- [ ] **Step 2: Write the verification script**

Create `scripts/verify-pack.mjs`:

```js
// Packs every publishable package and checks the resulting tarballs the way a
// consumer's package manager will read them. Catches publishConfig.exports
// mistakes, files-allowlist gaps, and workspace-protocol resolution problems
// that no in-repo test can see, because in-repo everything resolves to src/.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PACKAGES = ['core', 'prisma', 'bullmq', 'rabbitmq', 'pdf', 'video', 'optimizers']

const outDir = mkdtempSync(join(tmpdir(), 'nml-pack-'))
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', encoding: 'utf8' })

console.log(`Packing into ${outDir}\n`)
for (const name of PACKAGES) {
  run('pnpm', ['--filter', `@node-media-library/${name}`, 'pack', '--pack-destination', outDir])
}

const tarballs = readdirSync(outDir).filter((f) => f.endsWith('.tgz'))
if (tarballs.length !== PACKAGES.length) {
  throw new Error(`expected ${PACKAGES.length} tarballs, found ${tarballs.length}`)
}

for (const tarball of tarballs) {
  console.log(`\n=== publint ${tarball} ===`)
  run('pnpm', ['exec', 'publint', join(outDir, tarball)])
  console.log(`\n=== attw ${tarball} ===`)
  run('pnpm', ['exec', 'attw', join(outDir, tarball)])
}

console.log(`\nTarballs kept at ${outDir} for the manual smoke install.`)
```

- [ ] **Step 3: Wire it into the root scripts**

In the root `package.json`, add:

```json
    "verify-pack": "node scripts/verify-pack.mjs",
```

- [ ] **Step 4: Run it and triage the output**

Run:

```bash
pnpm build && pnpm verify-pack
```

Expected: seven tarballs packed, `publint` clean for each.

`attw` **will** report "no types" resolution failures for `moduleResolution: node10` — no package
declares a top-level `types` or `main`. That is the intended ESM-only stance, not a defect. Record it
in Step 6's document rather than "fixing" it by adding CJS entry points.

Any _other_ `publint` or `attw` finding is a real bug in the manifests — fix it before continuing.

- [ ] **Step 5: Smoke-install the tarballs outside the workspace**

This is the highest-value gate: the only check that resolves `publishConfig.exports` and the
`workspace:^` rewrite the way a consumer will.

```bash
SMOKE=$(mktemp -d) && cd "$SMOKE" && npm init -y >/dev/null && npm pkg set type=module
```

Install the packed tarballs (substitute the real paths printed by Step 4), then create `smoke.ts`:

```ts
import { createMediaLibrary, matchesMediaFilter, VERSION } from '@node-media-library/core'
import { prismaAdapter } from '@node-media-library/prisma'

console.log(VERSION, typeof createMediaLibrary, typeof matchesMediaFilter, typeof prismaAdapter)
```

Run it with `npx tsx smoke.ts`. Expected: prints `1.0.0 function function function`.
(`createMediaLibrary` is the public factory — `packages/core/src/library.ts:37`.)

Confirm there is exactly one copy of core:

```bash
find node_modules -type d -name core -path '*node-media-library*'
```

Expected: exactly one path. More than one means Task 9 did not take effect.

- [ ] **Step 6: Write the publishing runbook**

Create `docs/publishing.md`:

````markdown
# Publishing

## Before you publish

```bash
pnpm -r typecheck && pnpm -r test && pnpm build && pnpm verify-pack
```

Then do the smoke install described in the consumer-readiness plan, Task 11 Step 5.

## Prerequisites

- The `@node-media-library` npm scope must exist and be owned by the publishing account. Scoped
  publishes fail hard otherwise. (`.changeset/config.json` already sets `"access": "public"`.)
- If the account requires 2FA on publish, `changeset publish` prompts once per package — seven
  times. Use an automation token instead.

## Publishing

```bash
pnpm release
```

**pnpm only.** Each package's `prepack` (`scripts/ensure-pnpm-pack.mjs`) deliberately fails under
bare `npm publish`, because npm ignores `publishConfig.exports` and would ship a tarball whose entry
points reference unbuilt `src/`.

## Known, accepted limitations

- **No CJS entry points.** No package declares a top-level `types` or `main`, so consumers on
  `moduleResolution: node10` cannot resolve these packages. This is deliberate — the project is
  ESM-only. `attw` reports it on every run; that is expected output, not a regression.
- **1.0.0 ships without npm provenance.** It is a manual publish; there is no publish workflow in
  `.github/workflows/`. CI-based publishing with `NPM_CONFIG_PROVENANCE=true` and
  `permissions: id-token: write` is deferred to 1.0.1+.

## If a publish fails partway

`changeset publish` is **not transactional**. A failure partway leaves the scope partially published,
with adapters depending on a core version that may not be on the registry.

Re-run `pnpm release` — it skips versions already on the registry. Do **not** unpublish. If 1.0.0
ships with a defect, respond with `npm deprecate` plus a 1.0.1.
````

- [ ] **Step 7: Verify formatting**

Run:

```bash
pnpm format:check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/verify-pack.mjs package.json docs/publishing.md pnpm-lock.yaml
git commit -m "chore: add pre-publish tarball verification and a publishing runbook"
```

---

## Spec coverage

| Spec section                               | Task |
| ------------------------------------------ | ---- |
| §1 Prisma peer range + README statement     | 1    |
| §2 VERSION injection, drift gate, API docs  | 2    |
| §3 `loadSharp()` two failure modes          | 3    |
| §3 optional peer, pdf/video, READMEs        | 4    |
| §4 `MediaFilter` + in-memory + contract     | 5    |
| §4 Prisma post-filter + `jsonPathStyle`     | 6    |
| §5 `MEDIA_FS_BASE_URL` + security caveat    | 7    |
| Scope boundary: `PathGenerator` caveat      | 7    |
| §6 guard + host-queue recipe                | 8    |
| §7.1 `workspace:^`                          | 9    |
| §7.2 hand-folded 1.0.0                      | 10   |
| §7.3 verification gates                     | 11   |
| §7.4 prerequisites and failure recovery     | 11   |
