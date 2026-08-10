# Publish-readiness gaps — Design Spec

**Date:** 2026-08-10
**Status:** Approved design, pre-implementation
**Goal:** Close the surface-level defects a first external consumer hits, while breaking changes are still free. Nothing is published to npm (`npm view @node-media-library/core` and `.../prisma` both 404 as of 2026-08-10), so the recommended Prisma schema and core's export surface can still be corrected without costing any adopter a migration.

## 1. Motivation

An audit ahead of dogfooding the library in a real application produced five reported gaps. Verifying them against the code confirmed four, reframed one, and surfaced two adjacent defects the report missed.

Confirmed as stated:

1. **`MEDIA_MODEL_SNIPPET` has no field-level `@map()`.** `packages/prisma/src/schema.ts:1-24` carries `@@map("media")` but leaves every field unmapped. The README presents the block as paste-into-`schema.prisma`, so it becomes the adopter's schema verbatim — quoted camelCase columns (`"modelType"`, `"collectionName"`) on Postgres, for the life of the table. The half-mapped state (table mapped, fields not) reads as an oversight rather than a choice.

2. **Only `@@index([modelType, modelId])`.** `findForModel` filters `{ modelType, modelId, collectionName? }` (`packages/prisma/src/adapter.ts:95-104`). The collection-scoped read falls off the end of the index.

3. **`@prisma/client ">=6.2 <8"` is unverified.** `packages/prisma/package.json:53-55` declares the range; `.github/workflows/ci.yml:13-14` runs a single `node: [22]` leg against the workspace lockfile's `@prisma/client ^7.9.1`. No 6.x is exercised anywhere, and the test fixture uses the newer `prisma-client` generator (`packages/prisma/test/prisma/schema.prisma:1-4`) rather than the `prisma-client-js` a 6.x consumer would typically run. CLAUDE.md treats docs that over-state shipped behavior as defects; an unproven peer range is the same category.

4. **`resolveStorage`/`ResolvedStorage` are `@internal` yet exported.** `packages/core/src/index.ts:9` does `export * from './storage/resolve.js'`, putting `resolveStorage`, `ResolvedStorage`, and `writeOptionsFor` in the barrel despite their `/** @internal */` tags (`resolve.ts:11,97,162,179`).

Reframed:

5. **Multi-tenant scoping was reported as "~1 hr, docs only."** It is not docs-only. `MediaRepository` exposes `findForModel(modelType, modelId, collection?)` and `iterateAll({ modelType?, collectionName? })` — there is no hook for an additional scope column, so a `storeId` is not expressible through the interface at all. It needs its own design pass, not a recipe bolted onto this one. See §6.

Surfaced during verification, not in the original report:

6. **The `@internal` tags are decorative.** No `stripInternal` appears in any tsconfig (`tsconfig.base.json` has none, nor does any package config). Every `@internal` symbol ships in the published `.d.ts`; the tag only affects typedoc output. The export surface is therefore wider than the annotations claim.

7. **The `size Int` escape-hatch comment describes something impossible.** `packages/prisma/src/schema.ts:12` instructs users to "switch to `BigInt` (and adjust `MediaRow`) for larger files". `MediaRow.size` is `number` (`packages/prisma/src/client.ts:12`) and so is core's `MediaRecord.size` (`packages/core/src/types.ts:13,26`) — both are library types the consumer cannot adjust. `mapping.ts:16` passes the value straight through. Following the comment yields `bigint` at runtime where core expects `number`.

Two claims in the report did **not** survive verification and are corrected in this spec:

- The composite index was justified partly by "`orderColumn` sorts want `[modelType, modelId, collectionName]`". It does not help the sort at all (§3.2).
- Gap 5 was scoped to two symbols. `writeOptionsFor` is in the same position, making it three (§4).

## 2. Scope

In scope:

- Field-level `@map()` across the canonical schema snippet and the test fixture.
- Widening the composite index to `[modelType, modelId, collectionName]`.
- Correcting the `size`/`BigInt` comment to state the limitation honestly.
- Documenting `iterateAll({ collectionName })`'s missing index.
- Narrowing the `@prisma/client` peer range to `>=7 <8`.
- Narrowing core's barrel to named storage exports, and correcting `ResolvedStorage`'s visibility.

Out of scope (§6 records the reasoning): multi-tenant scoping, `setOrder` transactionality, the cascade `select`-without-`id` behavior, and adding `stripInternal` to the build.

## 3. Prisma schema snippet

### 3.1 Field mapping

Every camelCase field in `MEDIA_MODEL_SNIPPET` gains a `@map()`; `@@map("media")` is unchanged. Resulting columns:

| Prisma field           | Column                  |
| ---------------------- | ----------------------- |
| `modelType`            | `model_type`            |
| `modelId`              | `model_id`              |
| `collectionName`       | `collection_name`       |
| `fileName`             | `file_name`             |
| `mimeType`             | `mime_type`             |
| `conversionsDisk`      | `conversions_disk`      |
| `customProperties`     | `custom_properties`     |
| `generatedConversions` | `generated_conversions` |
| `responsiveImages`     | `responsive_images`     |
| `orderColumn`          | `order_column`          |
| `createdAt`            | `created_at`            |
| `updatedAt`            | `updated_at`            |

`id`, `uuid`, `name`, `disk`, `size`, and `manipulations` are already single-word and need no mapping.

This set is exactly `spatie/laravel-medialibrary`'s own `media` table. For a port, matching the original's column names is the defensible default rather than a stylistic preference, and it makes a Laravel-to-Node data migration a straight table copy.

The change is inert to the adapter: `packages/prisma/src/adapter.ts` and `mapping.ts` name Prisma _fields_ exclusively and never touch column names. No adapter, mapping, or contract-suite code changes.

### 3.2 Index

`@@index([modelType, modelId])` becomes `@@index([modelType, modelId, collectionName])`.

The two-column prefix still serves collection-less `findForModel`, so this is a strict improvement with no regression. Deliberately **not** extended to cover the sort: `findForModel` orders by `[{ orderColumn: asc, nulls: last }, { createdAt: asc }]` (`adapter.ts:43-46`), and for an index to let Postgres skip the sort node the sort keys must follow the equality columns — `[modelType, modelId, collectionName, orderColumn, createdAt]`. That index cannot serve the collection-less call's ordering, because `collectionName` then sits between the equality prefix and the sort keys. No single index serves both shapes, and at realistic media-per-model cardinality (dozens of rows) the sort node is not the cost. One index, filter-shaped.

### 3.3 The `size`/`BigInt` comment

Replaced with a statement of the ceiling and no false escape hatch:

> `size Int` caps individual files at ~2GB. Raising it needs a coordinated change to `MediaRow` and core's `MediaRecord` — both type `size` as `number` — so it is a library change, not a schema-only one.

### 3.4 Test fixture parity

`packages/prisma/test/prisma/schema.prisma`'s `model Media` receives the identical mapped block, so the suite exercises the schema the README recommends rather than a lookalike.

The parity test at `packages/prisma/test/mapping.test.ts:55-62` compares field-_name_ sets, which would pass even if the snippet and the fixture disagreed on every `@map` target. It is tightened to compare the normalized model body (whitespace-collapsed, line-trimmed) so column names cannot drift silently.

### 3.5 Documented limitation

`packages/prisma/README.md` gains a note: `iterateAll({ collectionName })` filters on `collectionName` without `modelType` (`adapter.ts:123-146`), which no index serves — each batch is a sequential scan. Fine at the scale the `clean` command runs today; a `[collectionName]` index is a later call once that command is exercised against a large table. Disclosure now, no code change.

## 4. Core export surface

Three changes make the `@internal` intent real rather than decorative:

1. **`ResolvedStorage` loses its `@internal` tag** (`resolve.ts:97`). `MediaLibrary.storage` is a public getter returning it (`packages/core/src/library.ts:331`), so the type is already part of the contract — no consumer can write typed code against that getter without naming it. The tag was simply wrong.

2. **`packages/core/src/index.ts:9` stops wildcarding.** `export * from './storage/resolve.js'` becomes named exports: `DiskConfig`, `StorageConfig`, `S3Credentials`, `ResolvedStorage`. `resolveStorage`, `writeOptionsFor`, and any other module-private helper cease to be reachable from the barrel.

3. **A surface test asserts the negative** — that the barrel does not export `resolveStorage` or `writeOptionsFor` — so reintroducing `export *` fails CI instead of silently re-widening the surface.

Standalone storage use stays unsanctioned. `resolveStorage` is a thin wrapper over flydrive, and `flydrive` is pinned to `^1` per CLAUDE.md because 2.x requires Node ≥24. Making the resolver public would freeze that pin into this library's own semver surface for a use case flydrive already serves directly. Consumers wanting storage without media should depend on flydrive.

`stripInternal` is not added to the build. It changes emit for every package, and with the barrel narrowed, the remaining `@internal` symbols are unreachable through the public entry points anyway. Revisit only if a genuinely internal type must stay exported from a public module.

## 5. Peer range

`packages/prisma/package.json:54`: `"@prisma/client": ">=6.2 <8"` becomes `">=7 <8"`. `packages/prisma/README.md:8` is updated to match.

This is the range CI actually proves. The adapter never imports `@prisma/client` — it is structurally typed through `PrismaLikeClient` (`packages/prisma/src/client.ts`) — so widening later is a minor bump rather than a redesign, with a 6.x CI leg as the price of admission. A 6.x leg is not worth building speculatively: the single pnpm lockfile means it needs either a second fixture package outside the workspace with its own lockfile, or a CI job that mutates the manifest with `--no-frozen-lockfile` _plus_ a 6.x-flavored fixture schema, since the generator provider differs.

`peerDependenciesMeta.optional` stays. Dropping it would warn on version mismatch, but would also break consumers importing the package's types without a Prisma client installed.

## 6. Out of scope, with reasons

**Multi-tenant scoping.** Its own spec. `MediaRepository` has no extra-column hook, so this is an interface question, not a documentation one. Two paths need no API change and should be evaluated there first: a tenant-scoped `$extends` client passed to `prismaAdapter` (which accepts any `PrismaLikeClient`), or tenancy encoded in `modelId`. One sharp edge to check when that work starts: `withMediaCascade` calls `findMany` on the _base_ client (`packages/prisma/src/cascade.ts:63-72`), so it may not compose with a tenant-filtered wrapper.

Recorded dissent: the advisory review argued a multi-shop application is multi-tenant from install day and ranked this the highest-priority item on the list. It is deferred by explicit decision, not by disagreement about its importance.

**`setOrder` transactionality.** `adapter.ts:115-121` issues N sequential `updateMany` calls with no transaction; a crash mid-reorder leaves interleaved ordering. Real, but behavior rather than surface — it can land post-publish as a patch without costing anyone a migration.

**Cascade skipped when `select` omits `id`.** `cascade.ts:37-42` documents this honestly already. Changing it to throw is a behavior decision, not a publish-readiness one.

## 7. Testing

- Existing contract suite (`packages/core/src/testing/repository-contract.ts`) is untouched and must stay green — field names do not change, so the adapter's behavior is unaffected by §3.
- `packages/prisma/test/mapping.test.ts` parity test tightened per §3.4; it must fail if a `@map` target is changed in one file and not the other.
- New core test asserting `resolveStorage` and `writeOptionsFor` are absent from the barrel's runtime exports. The four kept symbols are type-only and therefore unobservable at runtime; their presence is proven by a `import type { DiskConfig, StorageConfig, S3Credentials, ResolvedStorage } from '../src/index.js'` line in the same file, which `pnpm -r typecheck` enforces.
- `pnpm --filter @node-media-library/prisma db:prepare` must regenerate cleanly against the remapped fixture before the suite runs.

## 8. Changesets

Nothing is published, so semver has no adopters to protect, but changelog entries still matter:

- `fix(prisma)`: schema snippet column mapping, composite index, `size` comment, peer range narrowing.
- `fix(core)`: barrel narrowed to named storage exports; `ResolvedStorage` no longer marked internal.

## 9. Success criteria

- `MEDIA_MODEL_SNIPPET` and the test fixture are byte-identical in their `model Media` block, enforced by test.
- Pasting the snippet into a Postgres `schema.prisma` yields a snake_case `media` table matching spatie/laravel-medialibrary's columns.
- `packages/prisma/README.md` states the `@prisma/client` range CI proves, the ~2GB `size` ceiling without a false workaround, and the `iterateAll({ collectionName })` scan.
- `import { resolveStorage } from '@node-media-library/core'` fails to resolve; `import type { ResolvedStorage }` succeeds.
- `pnpm -r typecheck`, `pnpm -r test`, and `pnpm format:check` all pass.
