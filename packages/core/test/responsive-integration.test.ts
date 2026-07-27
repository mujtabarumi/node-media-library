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
import { DefaultPathGenerator } from '../src/storage/path-generator.js'
import { conversionKey } from '../src/conversions/naming.js'

let root: string
let repo: InMemoryMediaRepository
let library: MediaLibrary
let jpeg: Buffer

const baseUrl = 'http://example.test/media'

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'nml-responsive-integration-'))
  repo = new InMemoryMediaRepository()
  jpeg = await sharp({
    create: { width: 1600, height: 1200, channels: 3, background: { r: 40, g: 90, b: 180 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer()

  library = createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
    models: {
      Post: {
        collections: {
          images: collection()
            .withResponsiveImages()
            .conversions({
              preview: conversion().width(400).format('webp').nonQueued().withResponsiveImages(),
            }),
        },
      },
    },
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('responsive images end-to-end', () => {
  it('runs the full add -> read -> delete cycle', async () => {
    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    // conversion file exists; responsive variants exist for BOTH 'original' and 'preview'
    const pathGen = new DefaultPathGenerator()
    const previewDef = library.getCollectionDefinition('Post', 'images').conversions.preview!
    const previewPath = join(root, conversionKey(media, pathGen, previewDef, 'preview'))
    expect(existsSync(previewPath)).toBe(true)

    const stored = await repo.findById(media.id)
    expect(stored).not.toBeNull()
    const originalEntry = stored!.responsiveImages['original'] as { files: Array<{ fileName: string; width: number }> }
    const previewEntry = stored!.responsiveImages['preview'] as { files: Array<{ fileName: string; width: number }> }
    expect(originalEntry?.files?.length).toBeGreaterThan(0)
    expect(previewEntry?.files?.length).toBeGreaterThan(0)

    for (const f of originalEntry.files) {
      expect(existsSync(join(root, pathGen.directory(media), 'responsive', f.fileName))).toBe(true)
    }
    for (const f of previewEntry.files) {
      expect(existsSync(join(root, pathGen.directory(media), 'responsive', f.fileName))).toBe(true)
    }

    // urlGenerator.url(media, 'preview') resolves to the conversion file path
    const previewUrl = await library.urlGenerator.url(stored!, 'preview')
    expect(previewUrl).toBe(`${baseUrl}/${conversionKey(media, pathGen, previewDef, 'preview')}`)

    // srcset(media.id) and srcset(media.id, 'preview') both non-null; every URL starts with baseUrl
    const originalSrcset = await library.srcset(media.id)
    const previewSrcset = await library.srcset(media.id, 'preview')
    expect(originalSrcset).not.toBeNull()
    expect(previewSrcset).not.toBeNull()

    for (const part of originalSrcset!.split(', ')) {
      const [url] = part.split(' ')
      expect(url!.startsWith(baseUrl)).toBe(true)
    }
    for (const part of previewSrcset!.split(', ')) {
      const [url] = part.split(' ')
      expect(url!.startsWith(baseUrl)).toBe(true)
    }

    // placeholder(media.id) is an svg data URI
    const placeholder = await library.placeholder(media.id)
    expect(placeholder).not.toBeNull()
    expect(placeholder!.startsWith('data:image/svg+xml;base64,')).toBe(true)

    // deleteMedia(media.id) -> the media directory is fully gone (original,
    // conversions/, responsive/) and repository.findById returns null
    const mediaDir = join(root, pathGen.directory(media))
    expect(existsSync(mediaDir)).toBe(true)

    await library.deleteMedia(media.id)

    expect(existsSync(mediaDir)).toBe(false)
    expect(await repo.findById(media.id)).toBeNull()
  })
})
