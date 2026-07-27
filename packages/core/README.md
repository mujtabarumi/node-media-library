# @node-media-library/core

Node.js port of [spatie/laravel-medialibrary](https://github.com/spatie/laravel-medialibrary) — manage media files (images, documents, etc.) for your application models.

> **Pre-release**: Not yet published to npm; currently in active development. Currently covers file upload, storage, retrieval, and collection organization. Conversions, responsive images, queue jobs, and Prisma adapter land in Plans 2–6.

## Installation

Once published:
```bash
pnpm add @node-media-library/core
```

## Quick Start

```typescript
import { createMediaLibrary, InMemoryMediaRepository, collection } from '@node-media-library/core'
import { join } from 'node:path'

const library = createMediaLibrary({
  repository: new InMemoryMediaRepository(),
  storage: { disks: { default: { driver: 'fs', root: join(process.cwd(), 'media') } } },
  models: {
    User: {
      collections: {
        avatar: collection().singleFile().acceptsMimeTypes(['image/*']),
        gallery: collection().onlyKeepLatest(10),
      },
    },
  },
})

// Add a file
const file = await import('node:fs/promises').then(fs => fs.readFile('photo.png'))
const media = await library.for('User', userId).add(file).usingName('Avatar').toCollection('avatar')

// Retrieve files
const all = await library.for('User', userId).getAll()
const url = await library.for('User', userId).firstUrl('avatar')
const avatars = await library.for('User', userId).getAll('avatar')

// Manage collections
await library.for('User', userId).reorder([mediaId2, mediaId1])
await library.for('User', userId).clear('gallery')
```

## Roadmap

**Plan 1**: File upload, storage, retrieval, collections (current).

**Plans 2–6**: Conversions (Plan 2), responsive images (Plan 4), queue jobs (Plan 3), downloads & CLI (Plan 6), Prisma adapter (Plan 2).

Database: `InMemoryMediaRepository` (testing only). Production adapters in Plan 2.

## License

MIT
