# @node-media-library/prisma

## 1.0.0

> **First published release.** The entries below record development that predates this package
> reaching npm, so the breaking-change and migration notes describe commits rather than a shipped
> release. Nothing here requires action from a new installation.

- The `@prisma/client` peer range widened to `>=6 <8`. The adapter imports nothing from the client,
  so it is not tied to a single major. CI exercises Prisma 7 only.
- `iterateAll` honors `MediaFilter.customProperties`. It filters in the application by default;
  an opt-in `jsonPathStyle: 'postgres' | 'mysql'` pushes matching scalar values (string, number,
  boolean) into the SQL `where` clause. Objects, arrays, and `null` are always filtered in the
  application afterward, since Prisma's JSON `equals` is not guaranteed to match this library's
  deep-equality semantics for those.
- `MEDIA_MODEL_SNIPPET` now maps every field to a snake_case column via `@map()`, so pasting it
  yields the same column names as `spatie/laravel-medialibrary` instead of quoted camelCase
  identifiers on Postgres. Its `@@index` widens to `[modelType, modelId, collectionName]` so
  collection-scoped `findForModel` reads stay covered by an index. The README's `size`/`BigInt` note
  is corrected — it previously told readers to adjust `MediaRow`, a library type they cannot change —
  and now documents that `iterateAll({ collectionName })` without `modelType` is not served by that
  index.
- The published package now depends on `@node-media-library/core` with a caret range rather than an
  exact pin.

### Minor Changes

- 6698e20: Raise the supported Node floor from `>=20` to `>=22`.

  `file-type@22`, a runtime dependency of core, declares `node: >=22`. Core previously declared
  `>=20`, so installing on Node 20 produced an `EBADENGINE` warning (and a hard failure under
  `engine-strict`) while the package claimed to support it. Every package's `engines` field now says
  `>=22`, matching what the dependency tree actually requires.

  **Node 20 is no longer supported.** Consumers on Node 20 should stay on the previous release or
  upgrade to Node 22. `@types/node` moves to `^22` to keep types tracking the minimum supported
  runtime, and CI now tests Node 22 only.

### Patch Changes

- Updated dependencies [e8b7700]
- Updated dependencies [ea06f00]
- Updated dependencies [6698e20]
- Updated dependencies [d092bf5]
- Updated dependencies [8f9bf4d]
- Updated dependencies [6be9a32]
  - @node-media-library/core@1.0.0
