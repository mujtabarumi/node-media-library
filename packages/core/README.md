# @node-media-library/core

Node.js port of [spatie/laravel-medialibrary](https://github.com/spatie/laravel-medialibrary) — manage media files (images, documents, etc.) for your application models.

> **Pre-release**: This package is not yet published to npm. It is in active development across multiple plans. Currently covers file upload, storage, retrieval, and collection organization. Future releases will add conversions, responsive images, queue jobs, and database adapters (Prisma first).

## Installation

```bash
# Not yet on npm; clone or git+https
pnpm add @node-media-library/core
```

## Setup

Configure the library with a repository (where media metadata is stored) and storage (where files live):

```typescript
import { createMediaLibrary, InMemoryMediaRepository, collection } from '@node-media-library/core'
import { join } from 'node:path'

const library = createMediaLibrary({
  repository: new InMemoryMediaRepository(), // For testing/prototyping
  storage: {
    disks: {
      default: { driver: 'fs', root: join(process.cwd(), 'storage/media') },
    },
  },
  models: {
    User: {
      collections: {
        avatar: collection().singleFile().acceptsMimeTypes(['image/*']),
        gallery: collection().onlyKeepLatest(10),
      },
    },
  },
})
```

## Usage

### Add a File

```typescript
const file = await import('node:fs/promises').then(fs => fs.readFile('photo.png'))

const media = await library
  .for('User', userId)
  .add(file)
  .usingName('My Avatar')
  .toCollection('avatar')

console.log(media.url) // http://localhost/media/...
```

### Retrieve Files

```typescript
// Get all media for a model
const all = await library.for('User', userId).getAll()

// Filter by collection
const avatars = await library.for('User', userId).getAll('avatar')

// Get the URL of the first file (or fallback)
const url = await library.for('User', userId).firstUrl('avatar')

// Reorder or clear a collection
await library.for('User', userId).reorder([mediaId2, mediaId1])
await library.for('User', userId).clear('gallery')
```

## Roadmap

**Plan 1 (current)**: File validation, upload pipeline, filesystem storage, collection organization, retrieval.

**Plans 2–6**: Conversions & transformations (Plan 2), responsive images (Plan 4), queue jobs (Plan 3), downloads & CLI (Plan 6), Prisma + auto-cascade (Plan 2), and more.

Database adapters currently available: `InMemoryMediaRepository` (testing/prototyping only). Production adapters coming in Plan 2.

## License

MIT
