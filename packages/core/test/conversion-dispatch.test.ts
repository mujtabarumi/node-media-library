import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createMediaLibrary, MediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { conversion } from '../src/definitions/conversion.js'
import { conversionKey } from '../src/conversions/naming.js'
import { DefaultPathGenerator } from '../src/storage/path-generator.js'
import { deferDriver } from '../src/queue.js'
import type { MediaEventMap } from '../src/events.js'

let root: string
let repo: InMemoryMediaRepository
let png: Buffer

function makeLibrary(overrides: Partial<Parameters<typeof createMediaLibrary>[0]> = {}): MediaLibrary {
  return createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root } } },
    models: {
      Post: {
        collections: {
          images: collection().conversions({
            thumb: conversion().width(8).height(8),
            badge: conversion().width(4).nonQueued(),
          }),
          docs: collection(),
        },
      },
    },
    ...overrides,
  })
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'nml-dispatch-'))
  repo = new InMemoryMediaRepository()
  png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 10, b: 10 } },
  })
    .png()
    .toBuffer()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('conversion dispatch from upload pipeline', () => {
  it('add() with syncDriver produces both derived files before toCollection resolves', async () => {
    const library = makeLibrary()
    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')

    const pathGen = new DefaultPathGenerator()
    const thumbDef = library.getCollectionDefinition('Post', 'images').conversions.thumb!
    const badgeDef = library.getCollectionDefinition('Post', 'images').conversions.badge!
    const thumbPath = join(root, conversionKey(media, pathGen, thumbDef, 'thumb'))
    const badgePath = join(root, conversionKey(media, pathGen, badgeDef, 'badge'))

    expect(existsSync(thumbPath)).toBe(true)
    expect(existsSync(badgePath)).toBe(true)
  })

  it('add() with deferDriver: nonQueued badge file exists immediately after toCollection, queued thumb eventually appears', async () => {
    const library = makeLibrary({ queue: deferDriver() })
    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')

    const pathGen = new DefaultPathGenerator()
    const thumbDef = library.getCollectionDefinition('Post', 'images').conversions.thumb!
    const badgeDef = library.getCollectionDefinition('Post', 'images').conversions.badge!
    const thumbPath = join(root, conversionKey(media, pathGen, thumbDef, 'thumb'))
    const badgePath = join(root, conversionKey(media, pathGen, badgeDef, 'badge'))

    // nonQueued ('badge') always finishes inline before toCollection()
    // resolves, regardless of driver.
    expect(existsSync(badgePath)).toBe(true)

    // Queued ('thumb') is enqueued BEFORE the nonQueued conversion runs
    // (fix round 1: queued work must be scheduled before any inline
    // conversion, so a later nonQueued failure can never leave it
    // unscheduled — see dispatchConversions()'s docstring). With
    // deferDriver its processor only runs on a later tick via
    // setImmediate, but because the nonQueued badge conversion above does
    // real, multi-step async I/O of its own, that later tick may already
    // have run its course by the time toCollection() resolves — so unlike
    // before the reorder, "queued file absent immediately after
    // toCollection()" is no longer a guaranteed observation, only
    // "eventually present" is.
    await vi.waitFor(() => {
      expect(existsSync(thumbPath)).toBe(true)
    })
  })

  it('updateManipulations persists and regenerates', async () => {
    const library = makeLibrary({ queue: deferDriver() })
    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')

    const pathGen = new DefaultPathGenerator()
    const thumbDef = library.getCollectionDefinition('Post', 'images').conversions.thumb!
    const thumbPath = join(root, conversionKey(media, pathGen, thumbDef, 'thumb'))

    await vi.waitFor(() => {
      expect(existsSync(thumbPath)).toBe(true)
    })
    const initialMeta = await sharp(thumbPath).metadata()
    expect(initialMeta.width).toBe(8)

    const updated = await library.updateManipulations(media.id, { thumb: { width: 6 } })
    expect(updated.manipulations).toEqual({ thumb: { width: 6 } })

    await vi.waitFor(async () => {
      const meta = await sharp(thumbPath).metadata()
      expect(meta.width).toBe(6)
    })

    const persisted = await repo.findById(media.id)
    expect(persisted?.manipulations).toEqual({ thumb: { width: 6 } })
  })

  it('unsupported file adds fine and dispatches nothing', async () => {
    const library = makeLibrary()
    const events: Array<keyof MediaEventMap> = []
    library.events.on('conversion:started', () => events.push('conversion:started'))
    library.events.on('conversion:completed', () => events.push('conversion:completed'))

    const media = await library
      .for('Post', 1)
      .add(Buffer.from('hello world'))
      .usingFileName('note.txt')
      .toCollection('docs')

    const conversionsDir = join(root, 'Post', '1', 'docs', media.id, 'conversions')
    expect(existsSync(conversionsDir)).toBe(false)
    expect(events).toHaveLength(0)
  })

  it('queued conversions are scheduled before a nonQueued failure propagates', async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root } } },
      queue: deferDriver(),
      models: {
        Post: {
          collections: {
            mixed: collection().conversions({
              good: conversion().width(8),
              bad: conversion().width(4).format('webp').nonQueued(),
            }),
          },
        },
      },
    })

    // Force only the nonQueued ('bad') dispatch to fail, without touching
    // the queued ('good') path: performConversions() is what dispatchConversions()
    // calls for nonQueued names, so a one-shot rejection on it simulates a
    // real inline-conversion failure while leaving queue.enqueue() untouched.
    vi.spyOn(library, 'performConversions').mockRejectedValueOnce(new Error('bad conversion boom'))

    await expect(
      library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('mixed'),
    ).rejects.toThrow('bad conversion boom')

    // The record must still have been created (media:added already fired
    // before dispatch ran) even though toCollection() rejected.
    const [media] = await repo.findForModel('Post', '1', 'mixed')
    expect(media).toBeDefined()

    const pathGen = new DefaultPathGenerator()
    const goodDef = library.getCollectionDefinition('Post', 'mixed').conversions.good!
    const goodPath = join(root, conversionKey(media!, pathGen, goodDef, 'good'))

    // Queued 'good' was enqueued before the nonQueued failure, so it still
    // runs (on deferDriver's later tick) despite toCollection() rejecting.
    await vi.waitFor(() => {
      expect(existsSync(goodPath)).toBe(true)
    })
  })
})
