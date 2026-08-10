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
