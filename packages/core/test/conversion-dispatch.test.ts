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

  it('add() with deferDriver: nonQueued badge file exists immediately after toCollection, queued thumb only after a flush', async () => {
    const library = makeLibrary({ queue: deferDriver() })
    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')

    const pathGen = new DefaultPathGenerator()
    const thumbDef = library.getCollectionDefinition('Post', 'images').conversions.thumb!
    const badgeDef = library.getCollectionDefinition('Post', 'images').conversions.badge!
    const thumbPath = join(root, conversionKey(media, pathGen, thumbDef, 'thumb'))
    const badgePath = join(root, conversionKey(media, pathGen, badgeDef, 'badge'))

    expect(existsSync(badgePath)).toBe(true)
    expect(existsSync(thumbPath)).toBe(false)

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
})
