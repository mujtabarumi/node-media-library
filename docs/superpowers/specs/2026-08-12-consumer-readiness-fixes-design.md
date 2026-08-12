# Consumer-readiness fixes before the first 1.0.0 publish

**Date:** 2026-08-12
**Revised:** 2026-08-13, after two independent design reviews
**Status:** Approved, ready for planning
**Supersedes:** the peer-range decision in
[2026-08-10-publish-readiness-gaps-design.md](2026-08-10-publish-readiness-gaps-design.md) (§1 below
reverses the narrowing to `>=7 <8`). Every other item in that spec stands.

## Context

Nothing in this monorepo has been published yet — `npm view @node-media-library/core` returns 404,
and every package sits at `1.0.0` in the working tree from `c60f5ed`. The first real external
consumer, the ReturnFlow Shopify app, ran an integration review against the current `main` and
reported seven gaps.

All seven were verified against the code. Two are defects where the published manifest would
misdescribe the package. Four are integration-ergonomics gaps that only surface when an outside
application wires the library up — which had never happened before. One is not a gap at all but a
judgment call about semver.

The high gap count is a consequence of ReturnFlow being the first consumer, not evidence the library
is unready. This spec closes the six worth closing before the first publish.

### What the review got wrong, and why it matters

Two reported gaps are meaningfully smaller than described, and both reductions shrink this spec.
Both rebuttals were independently re-verified during design review and both hold:

- **"No host-app-queue story" is a docs gap, not a structural one.**
  `MediaLibrary.performConversions(mediaId, names?)` is already public
  (`packages/core/src/library.ts:204`). A host bridge is genuinely ~40 lines: `enqueue` delegates to
  the host dispatcher, and the host's job handler calls `performConversions()`. No new API is needed
  — no `processConversionJob()`, no `startWorker()`-capture hack. The constructor path was traced to
  confirm this: `library.ts:151` probes drivers with `typeof`, `:159` throws only when _both_
  `attach` and `work` are callable, and `:170` attaches in-process drivers only. A
  `BrokerQueueDriver` whose `work()` throws has `attach === undefined`, so it passes every guard and
  is never attached.
- **"Local-fs gives storage but no URLs" overstates it.** `library.download()`
  (`packages/core/src/library.ts:578`) and `library.inline()` (`:582`) already return Web `Response`
  objects built from `disk.getStream()` with Content-Type/Length/Disposition set, driver-agnostic. So
  serving local media from a route handler is `return library.inline(id)`. There is no route to
  bundle. The real gap is a missing env var and missing documentation.

### Scope boundary: no tenant concept enters the library

`PathGenerator` is swappable via the `MediaLibraryConfig.pathGenerator` field
(`packages/core/src/config.ts:34`, defaulted at `:83`), and `FileAdder` populates `customProperties`
on the record _before_ calling `pathGenerator.path()` (`file-adder.ts:126` then `:134`), so a
`stores/<storeId>/…` generator genuinely works from outside today. The only part of tenant-scoped
operation a consumer cannot build from outside is querying by a custom property, which §4 addresses
generically. The library gains no notion of a tenant, store, or account.

One caveat the docs must carry: `file-adder.ts:134` passes `newRecord as unknown as MediaRecord`, a
`NewMediaRecord` with no `createdAt`/`updatedAt`. A custom generator with a date-derived layout
breaks at upload time.

## Goals

1. The published manifests describe the package accurately.
2. A consumer on Prisma 6 can install the adapter without a peer warning.
3. A consumer who stores files and never converts them does not install sharp's native binaries.
4. A consumer can enumerate media by a custom property, with a documented path to pushing that
   filter into the database rather than scanning.
5. A consumer with its own queue infrastructure has a documented, safe integration path.
6. A consumer with no S3 in development can see an uploaded file.
7. The first publish produces seven correct, mutually consistent tarballs at version 1.0.0.

## Non-goals

- Multi-tenant path layout, tenant registries, or any per-tenant configuration.
- A bundled HTTP route or framework adapter.
- **Bulk delete.** There is no `deleteMany` on `MediaRepository` and none is added. `shop/redact`
  remains a filtered `iterateAll()` plus per-record `deleteMedia()`. Per-record storage deletes are
  unavoidable anyway (each record's files must be removed from the disk), so a bulk SQL delete would
  only remove the database round-trips, not the work. §4 closes the _query_ half of the gap; the
  deletion half stays a loop, by decision. `CleanOptions` and `RegenerateOptions` gain no filter
  passthrough.
- Indexing strategy for consumer databases beyond documenting what is required.

---

## 1. Widen the Prisma peer range to `>=6 <8`

`packages/prisma/package.json:54` declares `"@prisma/client": ">=7 <8"`. ReturnFlow is on `^6.6.0`.

The narrowing was deliberate — it described the range CI exercises — but it describes the wrong
thing. Every non-relative import across `packages/prisma/src/` (`adapter.ts:1`, `adapter.ts:8`,
`cascade.ts:1`, `mapping.ts:1`) resolves to `@node-media-library/core`. Nothing imports
`@prisma/client` at all; `client.ts:22-44` declares the delegate shape by hand. So the peer range
should describe the client shapes the adapter is compatible with, not the single version CI happens
to install.

**Change:** `peerDependencies["@prisma/client"]` becomes `">=6 <8"`. `devDependencies` stays on
`^7.9.1`.

**Explicitly not doing:** adding a CI job that installs Prisma 6. It was designed (a dedicated job
running `pnpm install --no-frozen-lockfile` with a `pnpm.overrides` pin, then the existing repository
contract as the assertion) and deliberately dropped as not worth the plumbing for a package that
imports nothing from the client.

**The honest consequence, which must be documented rather than glossed:** CI exercises Prisma 7 only.
The `>=6` claim rests on static analysis of the import graph, not on a passing test. If a Prisma 6
incompatibility exists, this project will learn about it from a consumer bug report. The Prisma
package README therefore states which versions are actually exercised, so a consumer on 6 knows what
backs the claim. Per the project's docs rule, a range asserted more confidently than it is tested is
a defect.

**Scope limit added in review:** this argument covers the adapter as it exists today. §4 introduces
the first construct whose _accepted syntax_ varies by database connector, so §4 carries its own
compatibility statement rather than inheriting this one.

## 2. Inject VERSION at build time

`packages/core/src/index.ts:1` hardcodes `export const VERSION = '0.0.0'` while `package.json` says
`1.0.0`. It is a documented public export
(`website/src/content/docs/api/variables/VERSION.md`), so every bug report citing it cites the wrong
version.

**Change:**

- `packages/core/scripts/sync-version.mjs` reads `package.json` and writes
  `packages/core/src/version.ts` containing `export const VERSION = '<version>'`.
- `src/index.ts` re-exports from `./version.js` instead of declaring the constant.
- The script runs as part of `build` (before `tsc`) and `prepublishOnly`.
- The **root** `version` script becomes `changeset version && pnpm --filter @node-media-library/core
sync-version` (currently bare `changeset version`), so the generated file moves whenever
  changesets bumps `package.json`. Without this, the file goes stale at exactly the moment it
  matters.

**`src/version.ts` is committed, not gitignored.** The local `exports` map points at `./src/index.ts`
(`packages/core/package.json:33`) for workspace development, so a sibling package or example
importing `VERSION` must resolve it with no build having run. A gitignored generated file would break
`pnpm -r typecheck` on a clean checkout. `tsconfig.build.json` also sets `"rootDir": "src"`, which
independently rules out `import pkg from '../package.json'`.

**Rejected alternative:** `createRequire(import.meta.url)('../package.json').version` resolves
identically from `src/index.ts` and `dist/index.js` and needs no generation, no commit, and no drift
guard. It is rejected because it makes `VERSION` a runtime read rather than a constant, defeating
tree-shaking and constant-folding for every consumer who bundles. Recorded here so the decision is
not re-litigated.

**Drift guard — corrected after review.** The original design ("a test asserting `VERSION` equals
`package.json`'s version") **cannot fail in CI**. `.github/workflows/ci.yml` runs `pnpm -r build`
(line 52) before `pnpm -r test` (line 53), so `sync-version.mjs` regenerates the file before any test
reads it; a stale committed file self-heals and the assertion passes. The guard must instead be a CI
step that regenerates and diffs, exactly like the existing `api-docs` job:

```yaml
- run: pnpm --filter @node-media-library/core sync-version
- name: version.ts is up to date
  run: git diff --exit-code -- packages/core/src/version.ts
```

The unit test is still worth keeping as fast local feedback, but the `git diff --exit-code` step is
what actually enforces the invariant.

**Also in scope:** `website/src/content/docs/api/variables/VERSION.md:7` renders `"0.0.0"` and the
`api-docs` CI job fails on any diff, so the API reference must be regenerated in the same change.

## 3. Move sharp to an optional peer dependency

`sharp` is in `packages/core/package.json` `dependencies`, so its native binaries install into every
image — API and worker alike — even for a consumer who only stores files.

Runtime behavior is already correct: all four production call sites use `await import('sharp')`
(`conversions/image-generator.ts:35`, `responsive/generator.ts:15` and `:31`,
`conversions/engine.ts:149`), so sharp never loads unless a conversion actually runs. The problem is
purely the install footprint.

Moving a dependency to a peer after 1.0.0 costs a major, which is why this belongs here rather than
in a follow-up minor. (§4 turns out to share that property — see its own note.)

**Change:**

- `sharp` moves from `dependencies` to `peerDependencies` with
  `peerDependenciesMeta: { sharp: { optional: true } }`, matching the established pattern already
  used for `@aws-sdk/client-s3` and `@google-cloud/storage`.
- **Peer range: `">=0.33 <1"`.** Not `^0.35.3`. sharp is pre-1.0, so a caret range means
  `>=0.35.3 <0.36.0` — a window narrow enough to force a core release on every sharp minor and to
  generate peer warnings for consumers within months. The operations used (`resize`, `rotate`,
  `greyscale`, `blur`, `sharpen`, format encoders) have been stable since 0.33.
- It is added to `devDependencies` so this repo's own suites still run — also the existing aws-sdk
  pattern.
- The four dynamic imports collapse into one internal `loadSharp()` helper that rethrows a
  `MediaLibraryError` naming the fix.
- **`packages/pdf` and `packages/video` declare the same optional peer.** Both import and call
  `sharpImageGenerator()` from core (`packages/pdf/src/generator.ts:2` and `:22`,
  `packages/video/src/generator.ts:2` and `:19`) — they rasterize a PDF page or video frame _into_
  it, so sharp is a hard runtime requirement for them. Today they get it transitively through core's
  `dependencies`; both list it in `devDependencies` only (`packages/pdf/package.json:53`,
  `packages/video/package.json:54`). After this change, `pnpm add @node-media-library/pdf` would
  otherwise yield a package that cannot do its job, with no warning. Adding a peer to a published
  package costs a major, so this must land in 1.0.0.
- **README updates.** `packages/core/README.md:17` says `pnpm add @node-media-library/core`, and the
  Quick Start immediately below configures a `.nonQueued()` conversion (`:54`) that runs inline on
  the first `add()`. A reader copying it verbatim would hit `loadSharp()`'s error on their first
  upload. Installation becomes `pnpm add @node-media-library/core sharp`, with a callout mirroring
  the existing optional-peer block for the AWS SDK at `README.md:378`, and a matching note on the
  `imageGenerators` config row at `README.md:94`. The pdf and video READMEs get the same treatment.

**`loadSharp()` must catch two distinct failures, not one.** The original design named only
`ERR_MODULE_NOT_FOUND` (sharp absent). The second mode — sharp installed but its platform binary
missing, surfacing as `ERR_DLOPEN_FAILED` or sharp's own "Could not load the sharp module" — becomes
_more_ likely once sharp is resolved separately from core rather than hoisted with it. Each gets its
own message: install it, versus reinstall for this platform / check the optional-dependency
architecture.

The wrapper is not optional polish. `resolveConfig` still defaults `imageGenerators` to
`[sharpImageGenerator()]` (`packages/core/src/config.ts:115`), so a consumer who skips sharp and then
converts an image would otherwise get a raw module-resolution stack trace from deep inside the
conversion engine — a strictly worse failure than today's, where the dependency is always present.

**Loose end this closes:** `packages/core/src/testing/storage-contract.ts:2` imports sharp
_statically_, and `./testing` is a published entry point. That import becomes dynamic. A consumer
running the storage contract against their own disk implementation should not need an image library
to do it.

## 4. Add `customProperties` to `MediaFilter`

`MediaFilter` is `{ modelType?, collectionName? }` (`packages/core/src/repository.ts:3`), so
"every record where `customProperties.storeId === X`" — needed for Shopify's `shop/redact` — means
iterating the whole table.

**Change:**

```ts
export interface MediaFilter {
  modelType?: string
  collectionName?: string
  /** Every key must deep-equal the record's corresponding customProperties value. */
  customProperties?: JsonObject
}
```

**Semantics, pinned.** AND across all supplied keys. **Deep structural equality** on JSON values, not
reference or `===` equality — `customProperties` is `JsonObject = Record<string, unknown>`
(`types.ts:1`), so a filter value may be a nested object or array, and the two backends would
otherwise diverge silently (JS `===` never matches an object; Prisma's JSON `equals` compares
structurally). A record missing the key does not match. Absent or empty `customProperties` matches
everything, preserving today's behavior. The contract suite carries a nested-value case specifically
to pin this.

**This item is breaking-if-deferred, for a non-obvious reason.** Adding an optional field to
`MediaFilter` is type-level additive, so third-party `MediaRepository` implementations keep
compiling. But they will _ignore_ the new field and silently return **unfiltered** results — and the
motivating use case is a deletion path. A backend that silently over-matches on `shop/redact` deletes
another tenant's media: no compile error, no runtime error, wrong data. `MediaFilter` is therefore
effectively closed after 1.0.0; a future field needs either a capability flag on `MediaRepository` or
a major.

### Prisma implementation: portable default, opt-in push-down

The original design said "JSON path equality in the `findMany` where clause." Review established
that **no such portable form exists**. Prisma's JSON `path` operand is connector-shaped: PostgreSQL
takes `path: ['storeId']`, MySQL and SQLite take `path: '$.storeId'`. A probe against this repo's
actual test database confirmed it — the `$.storeId` form returned the row, the array form threw
`PrismaClientValidationError`. And the mismatch is untypeable here: the adapter has no provider
knowledge, and `client.ts:30` types `findMany(args?: Record<string, unknown>)`, so TypeScript can
never catch it. An implementation written to pass the contract on the SQLite test DB would throw at
runtime on PostgreSQL — ReturnFlow's database.

The resolution:

- **Default: post-filter in the adapter.** `iterateAll` pushes `modelType`/`collectionName` down to
  the indexed columns as it does today, then filters `customProperties` in JS inside its existing
  keyset pagination loop (`adapter.ts:128-131`). Correct on every provider, passes the shared
  contract on SQLite, and no `path` syntax is involved.
- **Opt-in: `jsonPathStyle?: 'postgres' | 'mysql'`** on the adapter constructor. When set, the filter
  is pushed into the `where` clause using that dialect's `path` form. The consumer names their
  database; the adapter never guesses.

This keeps §1's structural-typing property intact — the adapter still imports nothing from
`@prisma/client` — while giving ReturnFlow the fast path behind one explicit option.

**Three implementations, one contract:**

- `packages/core/src/repository/in-memory.ts` — deep-equality comparison in `iterateAll`.
- `packages/prisma/src/adapter.ts` — post-filter by default, push-down under `jsonPathStyle`.
- `packages/core/src/testing/repository-contract.ts` — new cases including a nested value, so both
  backends are held to identical semantics. Per project convention, adding a repository capability
  means extending the shared contract, never writing parallel per-backend tests. The contract
  exercises the default (post-filter) path; a Prisma-only test covers `jsonPathStyle: 'mysql'`
  against the SQLite test DB, which accepts the `$.x` form.

**Documentation requirement.** The Prisma README must state plainly: the default filters in the
application, so it reads every row matching `modelType`/`collectionName`; `jsonPathStyle` pushes the
filter into SQL; and even then JSON matching is unindexed until the consumer adds an expression index
on the extracted path, which the README shows for PostgreSQL. It must also name which dialects are
exercised in CI and which are asserted, mirroring §1. Shipping a filter that reads as "avoids a table
scan" while performing one is exactly the kind of over-stating claim this codebase treats as a defect
rather than a nitpick.

## 5. Add `MEDIA_FS_BASE_URL` and document the no-S3 dev loop

`synthesizeDefaultDisk` (declared `packages/core/src/storage/resolve.ts:114`, fs branch at
`:150-154`) reads `MEDIA_FS_ROOT` but has no env var for `baseUrl` — while the r2 branch has
`MEDIA_R2_BASE_URL` (`:127`). Without `baseUrl`, `url()` throws for fs-backed media, so a developer
with no S3 cannot resolve a URL for a file they just uploaded. `publicUrlFor`
(`storage/url-generator.ts:105-112`) short-circuits on `config.baseUrl` for _any_ driver before
reaching `disk.getUrl()`, so setting it makes `url()` work regardless of the `visibility: 'private'`
that the fs branch hardcodes.

**Change:**

- `synthesizeDefaultDisk`'s fs branch reads `MEDIA_FS_BASE_URL` into `baseUrl` when set, mirroring
  the r2 branch exactly.
- A documentation section covering the two ways to see a locally stored file, **with a stated
  preference for the second**: set `MEDIA_FS_BASE_URL` and serve the root statically, or skip URLs
  entirely and return `library.inline(id)` from a route handler.

**Security note the docs must carry.** The fs branch hardcodes `visibility: 'private'`
(`resolve.ts:153`), and for r2 the library _throws at construction_ when a public collection has no
`baseUrl` (`url-generator.ts:120-126`). There is no equivalent check for fs. So setting
`MEDIA_FS_BASE_URL` and statically serving `MEDIA_FS_ROOT` exposes **every file under that root,
private collections included**, with no warning. That is why `library.inline()` is the recommended
path — it leaves authorization with the application. Per the project's "Security-sensitive paths"
rule this belongs in the docs, not just in a reviewer's head. The docs should also mention that
`PRODUCTION_FS_WARNING` fires for env-synthesized fs disks, so nobody files it as a bug after
following the recipe.

This is predominantly a discoverability fix. The serving capability shipped already; nothing pointed
at it.

## 6. Guard `performConversions()` and document the host-owned-queue recipe

`startWorker()` runs `assertConversionJob()` on every payload before it reaches the engine
(`packages/core/src/library.ts:234`, helper at `:70`), specifically so third-party drivers inherit
the shape guard for free. `performConversions()` (`:204`) delegates straight to the engine with no
check — and it is precisely the entry point a host-owned queue bridge calls, with a payload it just
deserialized from a broker.

**Change:**

- `performConversions()` validates its own arguments (string `mediaId`; `names` absent or an array of
  strings) before delegating to the engine. Without this, the recipe this spec is about to document
  is _less_ safe than the built-in path, which inverts the intent of the existing guard.
- A new section in `packages/core/docs/writing-a-queue-driver.md` — "Adopting the host application's
  queue" — showing a `BrokerQueueDriver` whose `enqueue` delegates to the host dispatcher and whose
  `work()` throws a clear "this driver is consumed by the host's worker, not `startWorker()`", paired
  with a host job handler calling `performConversions()`.

The doc currently frames `work()` as the required consumption path and `startWorker()` as how
consumption happens. Stating outright that a deliberately-throwing `work()` is a legitimate
implementation is the substance of this change — otherwise a reader concludes the library insists on
owning a second broker connection, which is what the ReturnFlow review concluded.

**The section must state the failure semantics, or it misleads.** `engine.perform()` rejects only
when _every_ requested conversion fails (`conversions/engine.ts:378-380`). It resolves silently on
missing media (`:247`), on no supporting generator (`:250`), and on partial failure. So a host
handler awaiting `performConversions()` acks a job in which two of three conversions failed — the
retry/backoff/DLQ the host is reusing never fires. Failures are observable only via the
`conversion:failed` event (`:370`). This is identical to `startWorker()`'s behavior and is not a
defect, but a recipe whose entire premise is "the host owns retries" must say it plainly or the host
will believe its DLQ covers conversion failures.

**Also state that the driver contract suite does not apply.**
`packages/core/docs/writing-a-queue-driver.md:151-183` instructs driver authors to validate with
`runBrokerQueueDriverContract`. A bridge with a throwing `work()` cannot pass it. The new section
must say so and name what to assert instead — that `enqueue` reaches the host dispatcher, and that
the host handler round-trips a payload through `performConversions()`.

## 7. Release mechanics

This section was rewritten after review; the original was internally contradictory and would not have
produced 1.0.0.

### 7.1 `workspace:*` → `workspace:^` (must happen before the first publish)

All six adapters declare `"@node-media-library/core": "workspace:*"` (`packages/prisma:51`,
`packages/bullmq:50`, `packages/rabbitmq:51`, `packages/optimizers:51`, `packages/pdf:49`,
`packages/video:50`). pnpm rewrites `workspace:*` at pack time to the **exact** version — `"1.0.0"`,
not a range. (`workspace:^` → `^1.0.0`.)

Consequence: `@node-media-library/prisma@1.0.0` hard-pins `@node-media-library/core@1.0.0`. The
moment core ships 1.0.1, a consumer with `core@^1.0.0` and `prisma@1.0.0` gets core 1.0.1 hoisted and
core 1.0.0 nested under prisma — **two copies of core in one dependency tree**. Since
`packages/prisma/src/adapter.ts:1` imports `MediaLibraryError` as a _value_, errors thrown by the
nested copy fail the consumer's `instanceof MediaLibraryError` against the hoisted one. Silent,
confusing, and reported as "your error class is broken."

The `fixed` lockstep group masks this only if consumers upgrade every package in lockstep, which a
library cannot assume. Six one-line edits, free now, permanently baked into any version already
published.

### 7.2 The first published version is 1.0.0, produced by hand, not by changesets

`changeset version` already ran at `c60f5ed` — `packages/core/CHANGELOG.md:3` and
`packages/prisma/CHANGELOG.md:3` already contain written `## 1.0.0` sections. `changeset publish`
does not consume changesets; it publishes whatever is in `package.json`. So "add a changeset per
package" and "publish 1.0.0" are mutually exclusive: running `changeset version` again yields 1.0.1,
or — because `.changeset/config.json` puts all seven packages in one `fixed` group and §3/§4 are
breaking — **2.0.0 across all seven as their first-ever published version**.

**Decision:** fold this work into the existing `## 1.0.0` CHANGELOG sections by hand, delete the two
pending changeset files (`core-storage-export-surface.md`, `prisma-schema-and-peer-range.md`, leaving
`README.md` and `config.json`), and publish 1.0.0 with `changeset publish` only. Changesets begin
governing at 1.0.1.

The rationale is that "breaking" is meaningless relative to an unpublished state. §3 and §4 are
breaking-if-deferred _because_ they would be breaking once 1.0.0 exists — marking them `major` now
would encode a break against a release nobody can install.

### 7.3 Pre-publish verification gates

The spec previously had no step between "write the code" and "publish." For a first publish built on
`publishConfig.exports` overrides — a mechanism this repo already distrusts enough to guard with
`scripts/ensure-pnpm-pack.mjs` — three gates are required:

- **`publint`** on each packed tarball: malformed `exports`, missing files, ESM/CJS mismatches.
- **`@arethetypeswrong/cli`** on each tarball: `types`-condition and resolution problems this dual-map
  setup is structurally prone to. Note no package declares a top-level `types` or `main`, so
  consumers on `moduleResolution: node10` will get "cannot find module." That is a defensible
  ESM-only stance — `attw` turns it into a recorded decision rather than a surprise bug report.
- **Smoke install.** `pnpm pack` all seven, install the tarballs into a scratch project _outside_ the
  workspace, `import { createMediaLibrary, VERSION } from '@node-media-library/core'`, import the
  prisma adapter, and typecheck. This single gate would independently catch §7.1, a bad `version.ts`
  emit path, and any `files`-allowlist gap.

### 7.4 Publish prerequisites and failure recovery

- The `@node-media-library` npm scope must exist and be owned by the publishing account. Scoped
  publishes fail hard otherwise. (`.changeset/config.json` already sets `"access": "public"`, which
  is the other half of this and is a very common first-publish failure — it is already correct.)
- **2FA posture.** If the account requires 2FA on publish, `changeset publish` across seven packages
  prompts seven times. An automation token is the norm.
- **Provenance.** `.github/workflows/` contains only `ci.yml` and `docs.yml`; neither references npm
  auth or `id-token`. So 1.0.0 is a manual publish from a laptop and ships without provenance.
  That is an acceptable choice for a first release — but it is a choice, recorded here, with CI-based
  publishing and `NPM_CONFIG_PROVENANCE=true` deferred to 1.0.1+.
- **`changeset publish` is not transactional.** If it fails partway (registry hiccup, 2FA timeout),
  the scope is left partially published, with adapters pinning a core version that may not be on the
  registry. Recovery is to re-run it — it skips already-published versions — never to unpublish.
  If 1.0.0 ships with a defect, the response is `npm deprecate` plus 1.0.1.
- Publishing goes through **pnpm only**. Each package's `prepack` (`scripts/ensure-pnpm-pack.mjs`)
  deliberately fails under bare `npm publish`, because npm ignores `publishConfig.exports` and would
  ship a tarball whose entry points reference unbuilt `src/`.
- No `exports` map changes are involved, so no dual-export-map updates are needed.

## Testing

Every item ships its own coverage. Tests hit real boundaries per project convention.

| Item | Test                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2    | CI step regenerates `version.ts` and fails on `git diff --exit-code`; a unit test asserting `VERSION` matches `package.json` is kept for local feedback only                                      |
| 3    | `loadSharp()` surfaces a distinct `MediaLibraryError` for each of the two failure modes (absent module, unloadable binary), mirroring the binary-missing companion tests in `packages/optimizers` |
| 4    | `customProperties` cases in `testing/repository-contract.ts` including a nested value, run against in-memory and the Prisma default path; a Prisma-only test for `jsonPathStyle: 'mysql'`         |
| 5    | `MEDIA_FS_BASE_URL` produces a working `url()` for fs-backed media                                                                                                                                |
| 6    | `performConversions()` rejects a malformed payload before the engine is reached                                                                                                                   |
| 7    | Smoke install of all seven packed tarballs into a scratch project outside the workspace, then typecheck                                                                                           |

Item 1 has no test by explicit decision (see §1).

## Risks

- **Prisma 6 is asserted, not verified** (§1). Accepted deliberately; mitigated by documenting the
  exercised range in the Prisma README.
- **Every converting consumer must install sharp explicitly** (§3). The earlier draft claimed peers
  are auto-installed and the impact would be negligible. That is **wrong for optional peers**: npm
  skips peers marked `optional` in `peerDependenciesMeta`, pnpm's `auto-install-peers` covers
  non-optional peers only, and Yarn never auto-installs peers at all. So `loadSharp()`'s error is the
  primary onboarding experience, not a fallback for stragglers — which is why the README changes in
  §3 are load-bearing rather than polish.
- **`jsonPathStyle` is a footgun if set wrong** (§4). A consumer who names the wrong dialect gets a
  runtime `PrismaClientValidationError` on first use, not a type error. Mitigated by defaulting to
  the portable path, so the option is opt-in and its failure is immediate and loud rather than
  silent.
- **`customProperties` filtering scans by default** (§4). Mitigated by documentation and the
  `jsonPathStyle` opt-in, not by code — the library cannot create indexes in a consumer's schema.
- **A third-party `MediaRepository` silently ignores the new filter** (§4). Unfixable in code for
  backends this project does not control; mitigated by shipping it in 1.0.0 so no such backend
  predates the field, and by the contract suite holding every in-tree backend to it.
