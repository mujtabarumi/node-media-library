# @node-media-library/core

Node.js port of [spatie/laravel-medialibrary](https://github.com/spatie/laravel-medialibrary) — manage media files (images, documents, etc.) for your application models.

> **Pre-release**: Not yet published to npm; currently in active development. Covers file upload, storage, retrieval, collection organization, image conversions, and queue-backed dispatch. Responsive images, PDF/video conversions, downloads, and a CLI land in later plans.

## Installation

Once published:
```bash
pnpm add @node-media-library/core
```

## Quick Start

```typescript
import { createMediaLibrary, InMemoryMediaRepository, collection, conversion } from '@node-media-library/core'
import { join } from 'node:path'

const library = createMediaLibrary({
  repository: new InMemoryMediaRepository(),
  storage: { disks: { default: { driver: 'fs', root: join(process.cwd(), 'media') } } },
  // Default `queue` is `syncDriver()` (inline). Swap in `bullmqDriver({ connection })`
  // from `@node-media-library/bullmq` to dispatch queued conversions to a worker.
  models: {
    User: {
      collections: {
        avatar: collection()
          .singleFile()
          .acceptsMimeTypes(['image/*'])
          .conversions({ thumb: conversion().width(64).height(64).nonQueued() }),
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
const thumbUrl = await library.for('User', userId).firstUrl('avatar', 'thumb')

// Manage collections
await library.for('User', userId).reorder([mediaId2, mediaId1])
await library.for('User', userId).clear('gallery')
```

## Roadmap

**Current**: File upload, storage, retrieval, collections, image conversions, queue-backed dispatch (sync and BullMQ), Prisma adapter.

**Remaining**: Responsive images (Plan 4), PDF/video conversion generators (Plan 5), downloads/ZIP/CLI (Plan 6).

## License

MIT
