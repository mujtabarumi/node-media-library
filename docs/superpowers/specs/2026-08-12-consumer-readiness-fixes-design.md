# Consumer-readiness fixes before the first 1.0.0 publish

**Date:** 2026-08-12
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

Two reported gaps are meaningfully smaller than described, and both reductions shrink this spec:

- **"No host-app-queue story" is a docs gap, not a structural one.**
  `MediaLibrary.performConversions(mediaId, names?)` is already public
  (`packages/core/src/library.ts:204`). A host bridge is genuinely ~40 lines: `enqueue` delegates to
  the host dispatcher, and the host's job handler calls `performConversions()`. No new API is needed
  — no `processConversionJob()`, no `startWorker()`-capture hack.
- **"Local-fs gives storage but no URLs" overstates it.** `library.inline()` and `library.download()`
  already return Web `Response` objects (`packages/core/src/library.ts:578`), so serving local media
  from a route handler is `return library.inline(id)`. There is no route to bundle. The real gap is a
  missing env var and missing documentation.

### Scope boundary: no tenant concept enters the library

`PathGenerator` is already swappable via `MediaLibraryConfig.pathGenerator`
(`packages/core/src/config.ts:83`), so a `stores/<storeId>/…` layout is consumer code today and stays
that way. The only part of tenant-scoped operation a consumer cannot build from outside is querying
by a custom property, which §4 addresses generically. The library gains no notion of a tenant, store,
or account.

## Goals

1. The published manifests describe the package accurately.
2. A consumer on Prisma 6 can install the adapter without a peer warning.
3. A consumer who stores files and never converts them does not install sharp's native binaries.
4. A consumer can query media by a custom property without iterating the whole table.
5. A consumer with its own queue infrastructure has a documented, safe integration path.
6. A consumer with no S3 in development can see an uploaded file.

## Non-goals

- Multi-tenant path layout, tenant registries, or any per-tenant configuration.
- A bundled HTTP route or framework adapter.
- Changing the lockstep-`1.0.0` release decision from `c60f5ed`.
- Indexing strategy for consumer databases beyond documenting what is required.

---

## 1. Widen the Prisma peer range to `>=6 <8`

`packages/prisma/package.json:54` declares `"@prisma/client": ">=7 <8"`. ReturnFlow is on `^6.6.0`.

The narrowing was deliberate — it described the range CI exercises — but it describes the wrong
thing. Every non-relative import across `packages/prisma/src/` (`adapter.ts`, `cascade.ts`,
`mapping.ts`) resolves to `@node-media-library/core`. Nothing imports `@prisma/client` at all. The
adapter is structurally typed against a `{ media: { findMany, create, … } }` shape, so the peer range
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

**`src/version.ts` is committed, not gitignored.** The local `exports` map points at `src/*.ts` for
workspace development, so a sibling package or example importing `VERSION` must resolve it with no
build having run. A gitignored generated file would break `pnpm -r typecheck` on a clean checkout.

**Drift guard:** a test asserting `VERSION` equals the version in `package.json`. Without it,
`pnpm changeset version` bumps `package.json` and the committed file goes stale silently — which is
the exact bug being fixed. The test is what makes the committed-generated-file approach safe.

## 3. Move sharp to an optional peer dependency

`sharp` is in `packages/core/package.json` `dependencies`, so its native binaries install into every
image — API and worker alike — even for a consumer who only stores files.

Runtime behavior is already correct: all four production call sites use `await import('sharp')`
(`conversions/image-generator.ts:35`, `responsive/generator.ts:15` and `:31`,
`conversions/engine.ts:149`), so sharp never loads unless a conversion actually runs. The problem is
purely the install footprint.

This is the only change in this spec that is breaking if deferred — moving a dependency to a peer
after 1.0.0 costs a major. That is why it belongs here rather than in a follow-up minor.

**Change:**

- `sharp` moves from `dependencies` to `peerDependencies` with
  `peerDependenciesMeta: { sharp: { optional: true } }`, matching the established pattern already
  used for `@aws-sdk/client-s3` and `@google-cloud/storage`.
- It is added to `devDependencies` so this repo's own suites still run — also the existing aws-sdk
  pattern.
- The four dynamic imports collapse into one internal `loadSharp()` helper that catches
  `ERR_MODULE_NOT_FOUND` and rethrows a `MediaLibraryError` naming the fix: install `sharp`, or
  supply your own `config.imageGenerators`.

The `loadSharp()` wrapper is not optional polish. `resolveConfig` still defaults `imageGenerators` to
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
  /** Exact-match: every key must equal the record's corresponding customProperties value. */
  customProperties?: JsonObject
}
```

Semantics: AND across all supplied keys; exact value equality; a record missing the key does not
match. Absent or empty `customProperties` matches everything, preserving today's behavior.

**Three implementations, one contract:**

- `packages/core/src/repository/in-memory.ts` — direct comparison in `iterateAll`.
- `packages/prisma/src/adapter.ts` — JSON path equality in the `findMany` where clause.
- `packages/core/src/testing/repository-contract.ts` — new cases, so both backends are held to the
  same semantics. Per project convention, adding a repository capability means extending the shared
  contract, never writing parallel per-backend tests.

**Documentation requirement.** JSON-column matching is unindexed by default, so on Postgres this is a
sequential scan until the consumer adds an expression index on the extracted path. The Prisma package
README must say this plainly and show the index. Shipping a filter that reads as "avoids a table
scan" while performing one is exactly the kind of over-stating claim this codebase treats as a defect
rather than a nitpick.

## 5. Add `MEDIA_FS_BASE_URL` and document the no-S3 dev loop

`synthesizeDefaultDisk` (`packages/core/src/storage/resolve.ts:151`) reads `MEDIA_FS_ROOT` for the fs
fallback disk but has no env var for `baseUrl` — while the r2 branch has `MEDIA_R2_BASE_URL` (`:127`).
Without `baseUrl`, `url()` throws for fs-backed media, so a developer with no S3 cannot resolve a URL
for a file they just uploaded.

**Change:**

- `synthesizeDefaultDisk`'s fs branch reads `MEDIA_FS_BASE_URL` into `baseUrl` when set, mirroring
  the r2 branch exactly.
- A documentation section covering the two ways to see a locally stored file: set `MEDIA_FS_BASE_URL`
  and serve the root statically, or skip URLs entirely and return `library.inline(id)` from a route
  handler, since it already produces a Web `Response`.

This is predominantly a discoverability fix. The serving capability shipped already; nothing pointed
at it.

## 6. Guard `performConversions()` and document the host-owned-queue recipe

`startWorker()` runs `assertConversionJob()` on every payload before it reaches the engine
(`packages/core/src/library.ts:238`), specifically so third-party drivers inherit the shape guard for
free. `performConversions()` has no such guard — and it is precisely the entry point a host-owned
queue bridge calls, with a payload it just deserialized from a broker.

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

## 7. Release mechanics

Two changesets are already pending (`core-storage-export-surface`, `prisma-schema-and-peer-range`)
and nothing is published, so all of this lands in the first `1.0.0` rather than as a follow-up.

- A changeset per affected package. The sharp move and the `MediaFilter` addition are the
  user-facing ones for core; the peer range for prisma.
- Publishing goes through **pnpm only**. Each package's `prepack` (`scripts/ensure-pnpm-pack.mjs`)
  deliberately fails under bare `npm publish`, because npm ignores `publishConfig.exports` and would
  ship a tarball whose entry points reference unbuilt `src/`.
- No `exports` map changes are involved, so no dual-export-map updates are needed.

## Testing

Every item ships its own coverage. Tests hit real boundaries per project convention.

| Item | Test                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2    | `VERSION` equals `package.json`'s version                                                                                                                    |
| 3    | `loadSharp()` surfaces a `MediaLibraryError` naming the fix when the module is absent, mirroring the binary-missing companion tests in `packages/optimizers` |
| 4    | `customProperties` cases in `testing/repository-contract.ts`, run against both in-memory and Prisma backends                                                 |
| 5    | `MEDIA_FS_BASE_URL` produces a working `url()` for fs-backed media                                                                                           |
| 6    | `performConversions()` rejects a malformed payload before the engine is reached                                                                              |

Item 1 has no test by explicit decision (see §1); item 7 is release process.

## Risks

- **Prisma 6 is asserted, not verified** (§1). Accepted deliberately; mitigated by documenting the
  exercised range in the Prisma README.
- **A consumer upgrading tooling could lose sharp** (§3). Peer dependencies are auto-installed by npm
  7+ and by pnpm's default `auto-install-peers`, so most consumers see no change; the `loadSharp()`
  error covers the rest with an actionable message.
- **`customProperties` filtering is slow without an index** (§4). Mitigated by documentation, not by
  code — the library cannot create indexes in a consumer's schema.
