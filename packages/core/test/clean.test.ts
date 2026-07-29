import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm, writeFile, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { conversion } from '../src/definitions/conversion.js'
import type { ImageGenerator } from '../src/conversions/image-generator.js'

let root: string
let repo: InMemoryMediaRepository
let jpeg: Buffer

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'nml-clean-'))
  repo = new InMemoryMediaRepository()
  jpeg = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const baseUrl = 'http://example.test/media'

function buildLibraryWithThumb() {
  return createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
    models: {
      Post: {
        collections: {
          images: collection().conversions({
            thumb: conversion().width(8).height(8).format('jpeg').nonQueued(),
          }),
        },
      },
    },
  })
}

function buildLibraryWithoutConversions() {
  return createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
    models: {
      Post: {
        collections: {
          images: collection(),
        },
      },
    },
  })
}

function buildLibraryWithOwnerExists(ownerExists: (type: string, id: string) => boolean) {
  const ownerRepo = new InMemoryMediaRepository({ ownerExists })
  const library = createMediaLibrary({
    repository: ownerRepo,
    storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
    models: {
      Post: { collections: { images: collection() } },
      User: { collections: { avatars: collection() } },
    },
  })
  return { library, ownerRepo }
}

async function conversionsDirFiles(mediaId: string): Promise<string[]> {
  try {
    return await readdir(join(root, mediaId, 'conversions'))
  } catch {
    return []
  }
}

describe('MediaLibrary.clean()', () => {
  it('1. deletes a stray file in the conversions dir without touching the real thumb or original', async () => {
    const library = buildLibraryWithThumb()
    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    const conversionsDir = join(root, media.id, 'conversions')
    await writeFile(join(conversionsDir, 'photo-old.jpeg'), Buffer.from('stray'))

    const before = await conversionsDirFiles(media.id)
    expect(before.sort()).toEqual(['photo-old.jpeg', 'photo-thumb.jpeg'])

    const result = await library.clean()

    expect(result.staleFilesDeleted).toBe(1)
    expect(result.orphanedMediaDeleted).toBe(0)
    expect(result.staleEntriesRemoved).toBe(0)
    expect(result.dryRun).toBe(false)

    const after = await conversionsDirFiles(media.id)
    expect(after).toEqual(['photo-thumb.jpeg'])

    const originalBytes = await readFile(join(root, media.id, 'photo.jpg'))
    expect(originalBytes.equals(jpeg)).toBe(true)

    const updated = await repo.findById(media.id)
    expect(updated?.generatedConversions['thumb']).toBe(true)
  })

  it('2. removes the stale conversion file and JSON key after the collection config drops the conversion', async () => {
    const libraryWithThumb = buildLibraryWithThumb()
    const media = await libraryWithThumb
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('photo.jpg')
      .toCollection('images')

    expect(await conversionsDirFiles(media.id)).toEqual(['photo-thumb.jpeg'])
    const beforeUpdate = await repo.findById(media.id)
    expect(beforeUpdate?.generatedConversions['thumb']).toBe(true)

    // Second library, same repository + storage, but the collection no
    // longer declares the 'thumb' conversion.
    const libraryNoConversions = buildLibraryWithoutConversions()

    const result = await libraryNoConversions.clean()

    expect(result.staleFilesDeleted).toBe(1)
    expect(result.staleEntriesRemoved).toBeGreaterThanOrEqual(1)

    expect(await conversionsDirFiles(media.id)).toEqual([])

    const updated = await repo.findById(media.id)
    expect(updated?.generatedConversions['thumb']).toBeUndefined()
    expect(updated?.responsiveImages['thumb']).toBeUndefined()

    const originalBytes = await readFile(join(root, media.id, 'photo.jpg'))
    expect(originalBytes.equals(jpeg)).toBe(true)
  })

  it('3. deleteOrphaned removes media (record + directory) only when the flag is set', async () => {
    const { library, ownerRepo } = buildLibraryWithOwnerExists((_type, id) => id !== 'gone')

    const orphan = await library.for('User', 'gone').add(jpeg).usingFileName('avatar.jpg').toCollection('avatars')
    const survivor = await library.for('User', 'stays').add(jpeg).usingFileName('avatar.jpg').toCollection('avatars')

    const withoutFlag = await library.clean({ deleteOrphaned: false })
    expect(withoutFlag.orphanedMediaDeleted).toBe(0)
    expect(await ownerRepo.findById(orphan.id)).not.toBeNull()

    const withFlag = await library.clean({ deleteOrphaned: true })
    expect(withFlag.orphanedMediaDeleted).toBe(1)

    expect(await ownerRepo.findById(orphan.id)).toBeNull()
    await expect(readdir(join(root, orphan.id))).rejects.toThrow()

    expect(await ownerRepo.findById(survivor.id)).not.toBeNull()
  })

  it('4. dryRun reports the same counts as a real run would, but changes nothing on disk or in records', async () => {
    const libraryWithThumb = buildLibraryWithThumb()
    const media = await libraryWithThumb
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('photo.jpg')
      .toCollection('images')
    const conversionsDir = join(root, media.id, 'conversions')
    await writeFile(join(conversionsDir, 'photo-old.jpeg'), Buffer.from('stray'))

    const libraryNoConversions = buildLibraryWithoutConversions()

    const dryRunResult = await libraryNoConversions.clean({ dryRun: true })

    expect(dryRunResult.dryRun).toBe(true)
    expect(dryRunResult.staleFilesDeleted).toBe(2) // stray file + now-stale thumb
    expect(dryRunResult.staleEntriesRemoved).toBeGreaterThanOrEqual(1)

    // Nothing was actually touched.
    expect((await conversionsDirFiles(media.id)).sort()).toEqual(['photo-old.jpeg', 'photo-thumb.jpeg'])
    const updated = await repo.findById(media.id)
    expect(updated?.generatedConversions['thumb']).toBe(true)

    const realResult = await libraryNoConversions.clean()
    expect(realResult.staleFilesDeleted).toBe(dryRunResult.staleFilesDeleted)
    expect(realResult.staleEntriesRemoved).toBe(dryRunResult.staleEntriesRemoved)
  })

  it('5. running clean() twice reports all-zero counts on the second run (idempotent)', async () => {
    const libraryWithThumb = buildLibraryWithThumb()
    const media = await libraryWithThumb
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('photo.jpg')
      .toCollection('images')
    await writeFile(join(root, media.id, 'conversions', 'photo-old.jpeg'), Buffer.from('stray'))

    const libraryNoConversions = buildLibraryWithoutConversions()

    const first = await libraryNoConversions.clean({ deleteOrphaned: true })
    expect(first.staleFilesDeleted).toBeGreaterThan(0)

    const second = await libraryNoConversions.clean({ deleteOrphaned: true })
    expect(second).toEqual({
      orphanedMediaDeleted: 0,
      staleFilesDeleted: 0,
      staleEntriesRemoved: 0,
      skippedUnregistered: 0,
      skippedUnregisteredTargets: 0,
      skippedWithoutGenerator: 0,
      dryRun: false,
    })
  })

  it('6. skips records whose modelType is not registered in this clean() config, leaving files+JSON untouched', async () => {
    const libraryWithThumb = buildLibraryWithThumb()
    const media = await libraryWithThumb
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('photo.jpg')
      .toCollection('images')

    expect(await conversionsDirFiles(media.id)).toEqual(['photo-thumb.jpeg'])

    // Second library, same repo/storage, but 'Post' isn't registered at all.
    const libraryWithoutModel = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      models: {
        User: { collections: { avatars: collection() } },
      },
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await libraryWithoutModel.clean()

    expect(result.skippedUnregistered).toBe(1)
    expect(result.skippedUnregisteredTargets).toBe(1)
    expect(result.skippedWithoutGenerator).toBe(0)
    expect(result.staleFilesDeleted).toBe(0)
    expect(result.staleEntriesRemoved).toBe(0)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('Post')
    warnSpy.mockRestore()

    expect(await conversionsDirFiles(media.id)).toEqual(['photo-thumb.jpeg'])
    const updated = await repo.findById(media.id)
    expect(updated?.generatedConversions['thumb']).toBe(true)
  })

  it('7. skips records whose modelType is registered but this specific collection is not, leaving files+JSON untouched', async () => {
    const libraryWithThumb = buildLibraryWithThumb()
    const media = await libraryWithThumb
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('photo.jpg')
      .toCollection('images')

    expect(await conversionsDirFiles(media.id)).toEqual(['photo-thumb.jpeg'])

    // Second library, same repo/storage: 'Post' is registered, but only with
    // a differently-named collection ('other', not 'images').
    const libraryWithDifferentCollection = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      models: {
        Post: { collections: { other: collection() } },
      },
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await libraryWithDifferentCollection.clean()

    expect(result.skippedUnregistered).toBe(1)
    expect(result.skippedUnregisteredTargets).toBe(1)
    expect(result.skippedWithoutGenerator).toBe(0)
    expect(result.staleFilesDeleted).toBe(0)
    expect(result.staleEntriesRemoved).toBe(0)
    warnSpy.mockRestore()

    expect(await conversionsDirFiles(media.id)).toEqual(['photo-thumb.jpeg'])
    const updated = await repo.findById(media.id)
    expect(updated?.generatedConversions['thumb']).toBe(true)
  })

  it('8. skips records with generated conversions whose mimeType has no registered generator, leaving files+JSON untouched', async () => {
    const fakeGenerator: ImageGenerator = {
      supports: (mime) => mime === 'application/x-fake',
      toImage: async () => Buffer.from('fake-thumb-bytes'),
    }

    const libraryWithFakeGenerator = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      imageGenerators: [fakeGenerator],
      models: {
        Post: {
          collections: {
            images: collection().conversions({
              thumb: conversion().width(8).height(8).format('jpeg').nonQueued(),
            }),
          },
        },
      },
    })

    const media = await libraryWithFakeGenerator
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('doc.jpg')
      .toCollection('images')

    // Reassign the mimeType to the fake type post-upload (the fake
    // generator isn't a real image codec, so it can't be sniffed from
    // real bytes) and generate the thumb conversion through it.
    await repo.update(media.id, { mimeType: 'application/x-fake' })
    await libraryWithFakeGenerator.performConversions(media.id, ['thumb'])

    const beforeUpdate = await repo.findById(media.id)
    expect(beforeUpdate?.generatedConversions['thumb']).toBe(true)
    expect(await conversionsDirFiles(media.id)).toContain('doc-thumb.jpeg')

    // Second library, same repo/storage, same model/collection config, but
    // WITHOUT the fake generator — only the default sharp generator, which
    // doesn't support 'application/x-fake'.
    const libraryWithoutGenerator = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      models: {
        Post: {
          collections: {
            images: collection().conversions({
              thumb: conversion().width(8).height(8).format('jpeg').nonQueued(),
            }),
          },
        },
      },
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await libraryWithoutGenerator.clean()

    expect(result.skippedUnregistered).toBe(1)
    expect(result.skippedUnregisteredTargets).toBe(0)
    expect(result.skippedWithoutGenerator).toBe(1)
    expect(result.staleFilesDeleted).toBe(0)
    expect(result.staleEntriesRemoved).toBe(0)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()

    expect(await conversionsDirFiles(media.id)).toContain('doc-thumb.jpeg')
    const afterClean = await repo.findById(media.id)
    expect(afterClean?.generatedConversions['thumb']).toBe(true)
  })

  it('9. counts both skip reasons independently when both occur in the same clean() run', async () => {
    const fakeGenerator: ImageGenerator = {
      supports: (mime) => mime === 'application/x-fake',
      toImage: async () => Buffer.from('fake-thumb-bytes'),
    }

    const libraryWithFakeGenerator = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      imageGenerators: [fakeGenerator],
      models: {
        Post: {
          collections: {
            images: collection().conversions({
              thumb: conversion().width(8).height(8).format('jpeg').nonQueued(),
            }),
          },
        },
      },
    })

    // Record 1: will be skipped for "no generator" (fake mimeType, generator absent in the clean() config below).
    const noGeneratorMedia = await libraryWithFakeGenerator
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('doc.jpg')
      .toCollection('images')
    await repo.update(noGeneratorMedia.id, { mimeType: 'application/x-fake' })
    await libraryWithFakeGenerator.performConversions(noGeneratorMedia.id, ['thumb'])

    // Record 2: will be skipped for "unregistered target" (modelType 'User' isn't registered below).
    const libraryWithUser = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      models: {
        User: { collections: { avatars: collection() } },
      },
    })
    const unregisteredMedia = await libraryWithUser
      .for('User', 2)
      .add(jpeg)
      .usingFileName('avatar.jpg')
      .toCollection('avatars')

    // clean() config: registers 'Post'/'images' (same generator gap as test 8) but not 'User' at all.
    const libraryForClean = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      models: {
        Post: {
          collections: {
            images: collection().conversions({
              thumb: conversion().width(8).height(8).format('jpeg').nonQueued(),
            }),
          },
        },
      },
    })

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await libraryForClean.clean()
    warnSpy.mockRestore()

    expect(result.skippedUnregisteredTargets).toBe(1)
    expect(result.skippedWithoutGenerator).toBe(1)
    expect(result.skippedUnregistered).toBe(result.skippedUnregisteredTargets + result.skippedWithoutGenerator)
    expect(result.skippedUnregistered).toBe(2)

    // Both records' files/JSON were left untouched.
    expect(await conversionsDirFiles(noGeneratorMedia.id)).toContain('doc-thumb.jpeg')
    const afterCleanNoGen = await repo.findById(noGeneratorMedia.id)
    expect(afterCleanNoGen?.generatedConversions['thumb']).toBe(true)
    const afterCleanUnregistered = await repo.findById(unregisteredMedia.id)
    expect(afterCleanUnregistered).not.toBeNull()
  })
})
