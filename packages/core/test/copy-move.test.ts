import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMediaLibrary, MediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const pngBuffer = Buffer.from(PNG_BASE64, 'base64')

let root: string
let library: MediaLibrary
let repo: InMemoryMediaRepository

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nml-copy-move-'))
  repo = new InMemoryMediaRepository()
  library = createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root, baseUrl: 'http://localhost:9000/media' } } },
    models: {
      post: {
        collections: {
          default: collection(),
        },
      },
      page: {
        collections: {
          default: collection().acceptsMimeTypes(['image/*']),
          single: collection().singleFile(),
        },
      },
    },
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('MediaLibrary copyMedia/moveMedia', () => {
  it('copyMedia creates an independent record for the target model', async () => {
    const src = await library
      .for('post', '1')
      .add(pngBuffer)
      .withCustomProperties({ alt: 'a cat' })
      .toCollection('default')
    const copy = await library.copyMedia(src.id, 'page', '9')
    expect(copy.id).not.toBe(src.id)
    expect(copy.modelType).toBe('page')
    expect(copy.modelId).toBe('9')
    expect(copy.collectionName).toBe('default')
    expect(copy.fileName).toBe(src.fileName)
    expect(copy.name).toBe(src.name)
    expect(copy.customProperties).toEqual({ alt: 'a cat' })
    // both files exist independently
    const disk = await library.storage.disk(src.disk)
    expect(await disk.exists(library.pathGenerator.path(src))).toBe(true)
    expect(await disk.exists(library.pathGenerator.path(copy))).toBe(true)
  })

  it('copyMedia emits media:copied', async () => {
    const events: string[] = []
    library.events.on('media:copied', () => events.push('copied'))
    const src = await library.for('post', '1').add(pngBuffer).toCollection('default')
    await library.copyMedia(src, 'page', '9')
    expect(events).toEqual(['copied'])
  })

  it('copyMedia enforces the target collection rules', async () => {
    // page.single is singleFile: copying twice leaves exactly one record
    const src = await library.for('post', '1').add(pngBuffer).toCollection('default')
    await library.copyMedia(src, 'page', '9', { toCollection: 'single' })
    await library.copyMedia(src, 'page', '9', { toCollection: 'single' })
    expect(await library.for('page', '9').getAll('single')).toHaveLength(1)
  })

  it('copyMedia to an unregistered model throws', async () => {
    const src = await library.for('post', '1').add(pngBuffer).toCollection('default')
    await expect(library.copyMedia(src, 'nope', '1')).rejects.toThrow()
  })

  it('moveMedia copies then deletes the source record and files', async () => {
    const src = await library.for('post', '1').add(pngBuffer).toCollection('default')
    const moved = await library.moveMedia(src.id, 'page', '9')
    expect(await library.repository.findById(src.id)).toBeNull()
    const disk = await library.storage.disk(src.disk)
    expect(await disk.exists(library.pathGenerator.path(src))).toBe(false)
    expect(await disk.exists(library.pathGenerator.path(moved))).toBe(true)
  })

  it('moveMedia emits media:moved (after media:copied)', async () => {
    const order: string[] = []
    library.events.on('media:copied', () => order.push('copied'))
    library.events.on('media:moved', () => order.push('moved'))
    const src = await library.for('post', '1').add(pngBuffer).toCollection('default')
    await library.moveMedia(src, 'page', '9')
    expect(order).toEqual(['copied', 'moved'])
  })

  it('copyMedia preserves the responsive-images request flag', async () => {
    const src = await library
      .for('post', '1')
      .add(pngBuffer)
      .withResponsiveImages()
      .toCollection('default')
    const copy = await library.copyMedia(src, 'page', '9')
    // The record returned by toCollection()/copyMedia() is a snapshot taken before
    // dispatchConversions() runs; with the sync queue driver, responsive generation
    // completes and lands in the repository, but the 'original' entry it merges in
    // is on a separate object reference the caller never sees. Only the `requested`
    // flag set at creation time is guaranteed to be on the returned record.
    expect(copy.responsiveImages['requested']).toBe(true)
  })
})
