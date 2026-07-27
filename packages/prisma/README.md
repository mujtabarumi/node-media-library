# @node-media-library/prisma

Prisma adapter for `@node-media-library/core`. Pre-release: not yet published to npm.

## Install
Once published: `npm install @node-media-library/prisma @prisma/client`
`@prisma/client` (`>=6.2 <8`) is an optional peer dependency — bring your own version.

## Add the model
Paste into `schema.prisma`, then run your own migrate flow (`prisma migrate dev` / `db push`):
```prisma
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
```
Also exported verbatim as `MEDIA_MODEL_SNIPPET`. Prisma 7 note: it generates the client into your own output dir — pass that instance into `prismaAdapter`, don't assume a package default.

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

## Options
`prismaAdapter(client, { owners })` takes an `owners` map (`modelType -> (modelId) => boolean | Promise<boolean>`), needed only by the future `clean --delete-orphaned` command (Plan 6) — most integrations can omit it.

## Roadmap
Orphan-cleanup CLI (`clean --delete-orphaned`) lands in Plan 6, building on `owners` above.
