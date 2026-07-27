import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
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

/** A noisy (non-flat) jpeg so it compresses to a meaningful byte size and
 * FileSizeOptimizedWidthCalculator produces more than a single width step. */
async function buildJpegFixture(width = 800, height = 600): Promise<Buffer> {
  const channels = 3
  const raw = Buffer.alloc(width * height * channels)
  for (let i = 0; i < raw.length; i++) {
    raw[i] = Math.floor(Math.random() * 256)
  }
  return sharp(raw, { raw: { width, height, channels } }).jpeg({ quality: 90 }).toBuffer()
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'nml-responsive-urls-'))
  repo = new InMemoryMediaRepository()
  jpeg = await buildJpegFixture()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const baseUrl = 'http://example.test/media'

describe('responsive read surface', () => {
  it('1. responsiveUrls(media.id) returns one URL per stored file, widest first, under /{id}/responsive/', async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      models: {
        Post: { collections: { images: collection().withResponsiveImages() } },
      },
    })

    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    const updated = await repo.findById(media.id)
    const entry = updated!.responsiveImages.original as { files: Array<{ fileName: string; width: number }> }

    const urls = await library.responsiveUrls(media.id)
    expect(urls).toHaveLength(entry.files.length)

    for (let i = 0; i < urls.length; i++) {
      expect(urls[i]).toContain(`/${media.id}/responsive/`)
      expect(urls[i]!.endsWith(entry.files[i]!.fileName)).toBe(true)
    }

    const widths = entry.files.map((f) => f.width)
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThan(widths[i - 1]!)
    }
  })

  it('2. srcset(media.id) equals files mapped to `${url} ${width}w` joined by ", "', async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      models: {
        Post: { collections: { images: collection().withResponsiveImages() } },
      },
    })

    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    const updated = await repo.findById(media.id)
    const entry = updated!.responsiveImages.original as { files: Array<{ fileName: string; width: number }> }

    const urls = await library.responsiveUrls(media.id)
    const expected = entry.files.map((f, i) => `${urls[i]} ${f.width}w`).join(', ')

    const srcset = await library.srcset(media.id)
    expect(srcset).toBe(expected)
  })

  it("3. placeholder(media.id) starts with 'data:image/svg+xml;base64,'", async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      models: {
        Post: { collections: { images: collection().withResponsiveImages() } },
      },
    })

    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    const placeholder = await library.placeholder(media.id)
    expect(placeholder).not.toBeNull()
    expect(placeholder!.startsWith('data:image/svg+xml;base64,')).toBe(true)
  })

  it('4. srcset for a conversion name: non-null when the conversion has withResponsiveImages()', async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      models: {
        Post: {
          collections: {
            images: collection().conversions({
              preview: conversion().width(50).format('webp').nonQueued().withResponsiveImages(),
            }),
          },
        },
      },
    })

    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    const srcset = await library.srcset(media.id, 'preview')
    expect(srcset).not.toBeNull()
    expect(srcset).toContain('w')
  })

  it('5. srcset/responsiveUrls/placeholder on media with no entry return null / [] / null', async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      models: {
        Post: {
          collections: {
            images: collection().conversions({
              thumb: conversion().width(8).height(8).nonQueued(),
            }),
          },
        },
      },
    })

    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    expect(await library.responsiveUrls(media.id)).toEqual([])
    expect(await library.srcset(media.id)).toBeNull()
    expect(await library.placeholder(media.id)).toBeNull()
  })

  it('6. regenerate({ withResponsive: true }) restores a wiped entry; then onlyMissing yields enqueued: 0', async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
      models: {
        Post: { collections: { images: collection().withResponsiveImages() } },
      },
    })

    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    const beforeWipe = await repo.findById(media.id)
    expect(beforeWipe?.responsiveImages.original).toBeDefined()

    await repo.update(media.id, { responsiveImages: {} })
    const wiped = await repo.findById(media.id)
    expect(wiped?.responsiveImages).toEqual({})

    const result = await library.regenerate({ withResponsive: true })
    expect(result.enqueued).toBeGreaterThan(0)

    const regenerated = await repo.findById(media.id)
    expect(regenerated?.responsiveImages.original).toBeDefined()

    const second = await library.regenerate({ withResponsive: true, onlyMissing: true })
    expect(second).toEqual({ enqueued: 0 })
  })
})
