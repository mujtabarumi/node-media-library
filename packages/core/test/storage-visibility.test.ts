import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createMediaLibrary, MediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { conversion } from '../src/definitions/conversion.js'

let root: string
let repo: InMemoryMediaRepository
let jpeg: Buffer

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'nml-visibility-'))
  repo = new InMemoryMediaRepository()
  jpeg = await sharp({
    create: { width: 200, height: 150, channels: 3, background: { r: 40, g: 90, b: 180 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function buildLibrary(isPublic: boolean): MediaLibrary {
  const collectionBuilder = isPublic
    ? collection()
        .public()
        .withResponsiveImages()
        .conversions({
          preview: conversion().width(50).format('webp').nonQueued().withResponsiveImages(),
        })
    : collection()
        .withResponsiveImages()
        .conversions({
          preview: conversion().width(50).format('webp').nonQueued().withResponsiveImages(),
        })

  return createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root } } },
    models: {
      Post: { collections: { images: collectionBuilder } },
    },
  })
}

/**
 * Spies on `disk.put()` for the library's default disk, capturing the
 * `options` (third) argument of every call made during `run()`. Storage is
 * resolved and memoized lazily by `library.storage.disk()`, so the disk must
 * be fetched (and the spy attached) before triggering writes.
 */
async function capturePutOptions(
  library: MediaLibrary,
  run: () => Promise<unknown>,
): Promise<Array<unknown>> {
  const disk = await library.storage.disk('default')
  const calls: Array<unknown> = []
  const originalPut = disk.put.bind(disk)
  vi.spyOn(disk, 'put').mockImplementation(async (key, contents, options) => {
    calls.push(options)
    return originalPut(key, contents, options)
  })
  await run()
  return calls
}

describe('collection().public() write visibility', () => {
  it('writes the original, the conversion, and both responsive variant sets with { visibility: "public" } for a public collection', async () => {
    const library = buildLibrary(true)

    const calls = await capturePutOptions(library, () =>
      library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images'),
    )

    // Original + conversion + responsive("original" widths) + responsive("preview" widths):
    // every disk.put() call for this add() must carry public visibility.
    expect(calls.length).toBeGreaterThan(1)
    for (const options of calls) {
      expect(options).toEqual({ visibility: 'public' })
    }
  })

  it('writes without a visibility override (disk default applies) for a non-public collection', async () => {
    const library = buildLibrary(false)

    const calls = await capturePutOptions(library, () =>
      library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images'),
    )

    expect(calls.length).toBeGreaterThan(1)
    for (const options of calls) {
      expect(options).toBeUndefined()
    }
  })
})
