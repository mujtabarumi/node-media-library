import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMediaLibrary, MediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import type { MediaRecord } from '../src/types.js'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const png = Buffer.from(PNG_BASE64, 'base64')

let root: string
let library: MediaLibrary
let repo: InMemoryMediaRepository

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nml-handle-'))
  repo = new InMemoryMediaRepository()
  library = createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root, baseUrl: 'http://localhost:9000/media' } } },
    models: {
      User: {
        collections: {
          gallery: collection(),
          'empty-registered': collection().fallbackUrl('/d.png'),
          'empty-default-only': collection().fallbackUrl('/default.png'),
        },
      },
    },
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ModelMediaHandle retrieval', () => {
  it('getAll() returns all collections in insertion order while getAll("gallery") filters', async () => {
    const avatar = await library.for('User', 1).add(png).toCollection('avatar')
    const gallery = await library.for('User', 1).add(png).toCollection('gallery')

    const all = await library.for('User', 1).getAll()
    expect(all.map((m) => m.id)).toEqual([avatar.id, gallery.id])

    const galleryOnly = await library.for('User', 1).getAll('gallery')
    expect(galleryOnly.map((m) => m.id)).toEqual([gallery.id])
  })

  it('getAll with an object filter matches only records whose customProperties deep-equal every key', async () => {
    const tagged = await library
      .for('User', 1)
      .add(png)
      .withCustomProperties({ tag: 'x' })
      .toCollection('gallery')
    await library.for('User', 1).add(png).withCustomProperties({ tag: 'y' }).toCollection('gallery')

    const matches = await library.for('User', 1).getAll('gallery', { tag: 'x' })
    expect(matches.map((m) => m.id)).toEqual([tagged.id])
  })

  it('getAll with a predicate filter works', async () => {
    const first = await library.for('User', 1).add(png).toCollection('gallery')
    const second = await library.for('User', 1).add(png).toCollection('gallery')

    const matches = await library.for('User', 1).getAll('gallery', (m: MediaRecord) => m.size > 0)
    expect(matches.map((m) => m.id)).toEqual([first.id, second.id])
  })

  it('firstUrl returns the registered fallback, null for an empty ad-hoc collection, and a real url otherwise', async () => {
    const registeredFallback = await library.for('User', 1).firstUrl('empty-registered')
    expect(registeredFallback).toBe('/d.png')

    const adhocFallback = await library.for('User', 1).firstUrl('empty-adhoc')
    expect(adhocFallback).toBeNull()

    await library.for('User', 1).add(png).toCollection('gallery')
    const galleryUrl = await library.for('User', 1).firstUrl('gallery')
    expect(galleryUrl).toMatch(/^http:\/\/localhost:9000\/media\//)
  })

  it("firstUrl falls back to the collection's default ('') fallback when no conversion-specific one is registered", async () => {
    // Only the default ('') fallback is registered — a conversion-scoped
    // lookup ('thumb') must still resolve to it rather than returning null,
    // matching Spatie's behavior.
    const viaConversion = await library.for('User', 1).firstUrl('empty-default-only', 'thumb')
    expect(viaConversion).toBe('/default.png')

    const viaSigned = await library.for('User', 1).firstSignedUrl('empty-default-only', 'thumb')
    expect(viaSigned).toBe('/default.png')
  })

  it('reorder(ids) flips the order returned by getAll', async () => {
    const first = await library.for('User', 1).add(png).toCollection('gallery')
    const second = await library.for('User', 1).add(png).toCollection('gallery')

    await library.for('User', 1).reorder([second.id, first.id])

    const reordered = await library.for('User', 1).getAll('gallery')
    expect(reordered.map((m) => m.id)).toEqual([second.id, first.id])
  })

  it('reorder(ids) ignores ids that do not belong to this handle, leaving the foreign record untouched', async () => {
    const own = await library.for('User', 1).add(png).toCollection('gallery')
    const foreign = await library.for('User', 2).add(png).toCollection('gallery')
    const foreignOriginalOrder = foreign.orderColumn

    await library.for('User', 1).reorder([foreign.id, own.id])

    const foreignAfter = await repo.findById(foreign.id)
    expect(foreignAfter?.orderColumn).toBe(foreignOriginalOrder)

    const ownAfter = await repo.findById(own.id)
    expect(ownAfter?.orderColumn).toBe(1)
  })

  it('clear("gallery") empties the collection, removes directories from disk, and emits collection:cleared', async () => {
    const first = await library.for('User', 1).add(png).toCollection('gallery')
    const second = await library.for('User', 1).add(png).toCollection('gallery')

    const events: Array<{ modelType: string; modelId: string; collection: string }> = []
    library.events.on('collection:cleared', (payload) => events.push(payload))

    await library.for('User', 1).clear('gallery')

    const remaining = await library.for('User', 1).getAll('gallery')
    expect(remaining).toEqual([])
    expect(existsSync(join(root, first.id))).toBe(false)
    expect(existsSync(join(root, second.id))).toBe(false)
    expect(events).toEqual([{ modelType: 'User', modelId: '1', collection: 'gallery' }])
  })

  it('clear("*") empties every collection (not just one literally named "*"), removes directories, and emits collection:cleared with "*"', async () => {
    const inGallery = await library.for('User', 1).add(png).toCollection('gallery')
    const inAvatar = await library.for('User', 1).add(png).toCollection('avatar')

    const events: Array<{ modelType: string; modelId: string; collection: string }> = []
    library.events.on('collection:cleared', (payload) => events.push(payload))

    await library.for('User', 1).clear('*')

    const remaining = await library.for('User', 1).getAll()
    expect(remaining).toEqual([])
    expect(existsSync(join(root, inGallery.id))).toBe(false)
    expect(existsSync(join(root, inAvatar.id))).toBe(false)
    expect(events).toEqual([{ modelType: 'User', modelId: '1', collection: '*' }])
  })
})
