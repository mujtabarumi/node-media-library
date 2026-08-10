# @node-media-library/prisma

Prisma adapter for `@node-media-library/core`. Pre-release: not yet published to npm.

## Install

Once published: `npm install @node-media-library/prisma @prisma/client`
`@prisma/client` (`>=7 <8`) is an optional peer dependency — bring your own version. The range is
what CI exercises; the adapter itself is structurally typed and never imports `@prisma/client`, so
support for older majors can be widened later once a CI leg proves it.

## Add the model

Paste into `schema.prisma`, then run your own migrate flow (`prisma migrate dev` / `db push`):

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

Also exported verbatim as `MEDIA_MODEL_SNIPPET`. Prisma 7 note: it generates the client into your own output dir — pass that instance into `prismaAdapter`, don't assume a package default.

`size Int` caps individual files at ~2GB. Raising it is a library change, not a schema-only one:
`MediaRow` and core's `MediaRecord` both type `size` as `number`, so changing the column alone would
hand `bigint` to code expecting `number`.

Ordering for a model's media uses `orderBy: [{ orderColumn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]`. The `nulls: 'last'` behavior is verified against SQLite in this repo's test suite; run the exported contract suite against your own Postgres/MySQL before relying on it there.

`iterateAll({ collectionName })` filters on `collectionName` without `modelType`, which the
`[modelType, modelId, collectionName]` index cannot serve — each batch is a sequential scan. That is
fine at the scale `clean` runs today; add a `[collectionName]` index if you run it against a large
table.

## Usage

```ts
import { createMediaLibrary } from '@node-media-library/core'
import { prismaAdapter } from '@node-media-library/prisma'
import { PrismaClient } from './generated/prisma/client.js'
const prisma = new PrismaClient()
const media = createMediaLibrary({
  repository: prismaAdapter(prisma),
  storage: { disks: { default: { driver: 'fs', root: './storage' } } },
  models: { User: {} },
})
```

## Cascading deletes (opt-in)

```ts
import { withMediaCascade } from '@node-media-library/prisma'
const xprisma = withMediaCascade(prisma, media)
await xprisma.user.delete({ where: { id: 'u1' } })
```

Cascaded models must expose a scalar `id` field — the extension reads `result.id` (delete) or each matched row's `id` (deleteMany) to call `clearFor`.

## Options

`prismaAdapter(client, { owners, iterateBatchSize })`: `owners` is a `modelType -> (modelId) => boolean | Promise<boolean>` map, needed only by the future `clean --delete-orphaned` command (Plan 6) — most integrations can omit it. `iterateBatchSize` (default `100`) sets the page size `iterateAll` fetches internally.

## Responsive images

The repository exposes two additional `MediaRepository` methods backing `@node-media-library/core`'s responsive images support: `markConversionGenerated(id, name, generated)` and `mergeResponsiveImages(id, conversion, entry)`. Both read-merge-write into the `generatedConversions` / `responsiveImages` JSON columns respectively, keyed by conversion name — a plain `update()` would clobber sibling keys written concurrently, which is why these merge instead of replace.

When your `PrismaLikeClient` stub (or the real `PrismaClient`) exposes `$transaction`, the read-modify-write runs inside it; without one it falls back to a plain sequential read then write. Note that `$transaction` alone does not make concurrent merges on the _same_ record fully atomic on Postgres/MySQL: their default isolation level (read committed) does not lock the row read by `findUnique`, so two concurrent transactions can both read the same pre-update row and, when both commit, one write can still be lost. SQLite serializes all writes (single-writer), so it does not have this gap — the "two concurrent calls for different names must both persist" contract from `@node-media-library/core`'s `MediaRepository` JSDoc holds there, but is not proven for Postgres/MySQL under `$transaction` alone.

## Roadmap

Orphan-cleanup CLI (`clean --delete-orphaned`) lands in Plan 6, building on `owners` above.
