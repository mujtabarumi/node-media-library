import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
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

let root: string
let library: MediaLibrary
let repo: InMemoryMediaRepository
let png: Buffer

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'nml-urls-'))
  repo = new InMemoryMediaRepository()
  png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 200, g: 10, b: 10 } },
  })
    .png()
    .toBuffer()

  library = createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root, baseUrl: 'http://localhost:9000/media' } } },
    models: {
      Post: {
        collections: {
          images: collection().conversions({
            thumb: conversion().width(8),
          }),
        },
      },
    },
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('conversion urls', () => {
  it("firstUrl(collection, 'thumb') returns the conversion URL once generated", async () => {
    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')
    const url = await library.for('Post', 1).firstUrl('images', 'thumb')
    expect(url).not.toBeNull()
    expect(url!.startsWith('http://localhost:9000/media')).toBe(true)
    expect(url!.endsWith(`/conversions/${media.fileName.replace(/\.png$/, '')}-thumb.png`)).toBe(true)
  })

  it('url falls back to original for an unknown/ungenerated name', async () => {
    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')
    const original = await library.urlGenerator.url(media)
    const fallback = await library.urlGenerator.url(media, 'nope')
    expect(fallback).toBe(original)
  })

  it('availableUrl picks the first generated conversion', async () => {
    await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')
    const url = await library.for('Post', 1).availableUrl('images', ['nope', 'thumb'])
    const media = (await library.for('Post', 1).first('images'))!
    const thumbUrl = await library.urlGenerator.url(media, 'thumb')
    expect(url).toBe(thumbUrl)
  })

  it('regenerate({ onlyMissing: true }) skips fully-generated media and regenerates missing ones', async () => {
    const media = await library.for('Post', 1).add(png).usingFileName('photo.png').toCollection('images')

    const fullyGenerated = await library.regenerate({ onlyMissing: true })
    expect(fullyGenerated).toEqual({ enqueued: 0 })

    await repo.update(media.id, { generatedConversions: {} })
    const pathGen = new DefaultPathGenerator()
    const thumbDef = library.getCollectionDefinition('Post', 'images').conversions.thumb!
    const thumbPath = join(root, conversionKey(media, pathGen, thumbDef, 'thumb'))
    rmSync(thumbPath, { force: true })
    expect(existsSync(thumbPath)).toBe(false)

    const result = await library.regenerate({ onlyMissing: true })
    expect(result).toEqual({ enqueued: 1 })
    expect(existsSync(thumbPath)).toBe(true)
  })

  it('regenerate({ ids, only }) targets exactly one record', async () => {
    const a = await library.for('Post', 1).add(png).usingFileName('a.png').toCollection('images')
    await library.for('Post', 2).add(png).usingFileName('b.png').toCollection('images')

    const result = await library.regenerate({ ids: [a.id], only: ['thumb'] })
    expect(result).toEqual({ enqueued: 1 })
  })
})
