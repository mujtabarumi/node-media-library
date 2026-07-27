import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createMediaLibrary, MediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { conversion } from '../src/definitions/conversion.js'
import { conversionFileName, conversionKey } from '../src/conversions/naming.js'
import { DefaultPathGenerator } from '../src/storage/path-generator.js'
import type { MediaEventMap } from '../src/events.js'
import type { MediaRecord } from '../src/types.js'

let root: string
let library: MediaLibrary
let repo: InMemoryMediaRepository
let png: Buffer

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'nml-conv-'))
  repo = new InMemoryMediaRepository()
  png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 10, b: 10 } },
  })
    .png()
    .toBuffer()

  library = createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root } } },
    models: {
      Post: {
        collections: {
          images: collection().conversions({
            thumb: conversion().width(8).height(8).nonQueued(),
            web: conversion().width(10).format('webp').nonQueued(),
          }),
        },
      },
    },
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('conversions', () => {
  it('conversionFileName formula', () => {
    expect(conversionFileName('photo.jpg', 'thumb', null)).toBe('photo-thumb.jpg')
    expect(conversionFileName('photo.jpg', 'web', 'webp')).toBe('photo-web.webp')
    expect(conversionFileName('file', 't', null)).toBe('file-t')
  })

  it('perform generates files, marks generatedConversions, emits started+completed', async () => {
    const events: Array<{ event: keyof MediaEventMap; conversion?: string }> = []
    library.events.on('conversion:started', (p) => events.push({ event: 'conversion:started', conversion: p.conversion }))
    library.events.on('conversion:completed', (p) => events.push({ event: 'conversion:completed', conversion: p.conversion }))

    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')
    await library.performConversions(media.id)

    const pathGen = new DefaultPathGenerator()
    const thumbDef = library.getCollectionDefinition('Post', 'images').conversions.thumb!
    const webDef = library.getCollectionDefinition('Post', 'images').conversions.web!
    const thumbPath = join(root, conversionKey(media, pathGen, thumbDef, 'thumb'))
    const webPath = join(root, conversionKey(media, pathGen, webDef, 'web'))

    expect(existsSync(thumbPath)).toBe(true)
    expect(existsSync(webPath)).toBe(true)

    const thumbMeta = await sharp(thumbPath).metadata()
    expect(thumbMeta.width).toBe(8)

    const updated = await repo.findById(media.id)
    expect(updated?.generatedConversions).toEqual({ thumb: true, web: true })

    expect(events.filter((e) => e.event === 'conversion:started').map((e) => e.conversion).sort()).toEqual(['thumb', 'web'])
    expect(events.filter((e) => e.event === 'conversion:completed').map((e) => e.conversion).sort()).toEqual(['thumb', 'web'])
  })

  it('format switch produces webp', async () => {
    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')
    await library.performConversions(media.id)
    const pathGen = new DefaultPathGenerator()
    const webDef = library.getCollectionDefinition('Post', 'images').conversions.web!
    const webPath = join(root, conversionKey(media, pathGen, webDef, 'web'))

    const meta = await sharp(webPath).metadata()
    expect(meta.format).toBe('webp')
  })

  it('per-media manipulations override', async () => {
    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')

    const withOverride = await repo.update(media.id, { manipulations: { thumb: { width: 4 } } })
    await library.performConversions(withOverride.id, ['thumb'])

    const pathGen = new DefaultPathGenerator()
    const thumbDef = library.getCollectionDefinition('Post', 'images').conversions.thumb!
    const thumbPath = join(root, conversionKey(withOverride, pathGen, thumbDef, 'thumb'))

    const meta = await sharp(thumbPath).metadata()
    expect(meta.width).toBe(4)
  })

  it('unsupported mime skips silently', async () => {
    const events: MediaRecord[] = []

    const textLibrary = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root } } },
      models: {
        Post: {
          collections: {
            docs: collection().conversions({
              thumb: conversion().width(8).height(8).nonQueued(),
            }),
          },
        },
      },
    })
    textLibrary.events.on('conversion:started', () => events.push({} as MediaRecord))

    const media = await textLibrary
      .for('Post', 1)
      .add(Buffer.from('hello world'))
      .usingFileName('note.txt')
      .toCollection('docs')

    await expect(textLibrary.performConversions(media.id)).resolves.toBeUndefined()

    const updated = await repo.findById(media.id)
    expect(updated?.generatedConversions).toEqual({})
    expect(events).toHaveLength(0)
  })

  it('failed conversion emits failed and does not mark generated', async () => {
    const failures: Array<{ conversion: string; error: unknown }> = []
    library.events.on('conversion:failed', (p) => failures.push({ conversion: p.conversion, error: p.error }))

    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')

    const disk = await library.storage.disk(media.disk)
    await disk.put(library.pathGenerator.path(media), Buffer.from('not an image'))

    await expect(library.performConversions(media.id, ['thumb'])).rejects.toThrow()

    expect(failures).toHaveLength(1)
    expect(failures[0]?.conversion).toBe('thumb')
    expect(failures[0]?.error).toBeDefined()

    const updated = await repo.findById(media.id)
    expect(updated?.generatedConversions.thumb).toBeUndefined()
  })

  it('concurrent perform() calls for the same media do not lose each other\'s generatedConversions marks', async () => {
    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')

    await Promise.all([
      library.performConversions(media.id, ['thumb']),
      library.performConversions(media.id, ['web']),
    ])

    const updated = await repo.findById(media.id)
    expect(updated?.generatedConversions).toEqual({ thumb: true, web: true })
  })

  it('event payloads are independent snapshots, not the same mutated record', async () => {
    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')

    const started: Array<{ conversion: string; media: MediaRecord }> = []
    const completed: Array<{ conversion: string; media: MediaRecord }> = []
    library.events.on('conversion:started', (p) => started.push({ conversion: p.conversion, media: p.media }))
    library.events.on('conversion:completed', (p) => completed.push({ conversion: p.conversion, media: p.media }))

    await library.performConversions(media.id)

    const firstStarted = started[0]
    expect(firstStarted).toBeDefined()
    // Whichever conversion ran first, its retained 'started' payload must
    // not have picked up the *other* conversion's mark after the fact —
    // proving the loop isn't mutating and re-emitting the same object.
    const otherName = firstStarted!.conversion === 'thumb' ? 'web' : 'thumb'
    expect(firstStarted!.media.generatedConversions[otherName]).toBeUndefined()

    for (const entry of completed) {
      expect(entry.media.generatedConversions[entry.conversion]).toBe(true)
    }
  })
})
