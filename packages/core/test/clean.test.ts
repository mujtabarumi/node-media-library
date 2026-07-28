import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm, writeFile, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { conversion } from '../src/definitions/conversion.js'

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
      dryRun: false,
    })
  })
})
