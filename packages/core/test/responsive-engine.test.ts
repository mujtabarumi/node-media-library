import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, existsSync, readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { conversion } from '../src/definitions/conversion.js'
import type { MediaEventMap } from '../src/events.js'
import type { ImageGenerator } from '../src/conversions/image-generator.js'

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
  root = mkdtempSync(join(tmpdir(), 'nml-responsive-'))
  repo = new InMemoryMediaRepository()
  jpeg = await buildJpegFixture()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function responsiveDir(mediaId: string): string {
  return join(root, mediaId, 'responsive')
}

describe('responsive engine integration', () => {
  it('1. add() with collection.withResponsiveImages() + syncDriver generates original responsive variants', async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root } } },
      models: {
        Post: { collections: { images: collection().withResponsiveImages() } },
      },
    })

    const events: Array<{ media: unknown; conversion: string }> = []
    library.events.on('responsive:generated', (p) => events.push(p))

    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    const dir = responsiveDir(media.id)
    expect(existsSync(dir)).toBe(true)
    const files = readdirSync(dir)
    expect(files.length).toBeGreaterThan(0)
    for (const fileName of files) {
      expect(fileName).toMatch(/___original_\d+_\d+\.jpe?g$/)
    }

    const updated = await repo.findById(media.id)
    const entry = updated?.responsiveImages.original as {
      files: Array<{ fileName: string; width: number; height: number }>
      placeholder?: string
    }
    expect(entry).toBeDefined()
    expect(Array.isArray(entry.files)).toBe(true)
    expect(entry.files.length).toBeGreaterThan(0)
    for (const variant of entry.files) {
      expect(typeof variant.fileName).toBe('string')
      expect(typeof variant.width).toBe('number')
      expect(typeof variant.height).toBe('number')
    }
    const widths = entry.files.map((f) => f.width)
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThan(widths[i - 1]!)
    }

    expect(entry.placeholder).toBeDefined()
    expect(entry.placeholder!.startsWith('data:image/svg+xml;base64,')).toBe(true)

    expect(events).toHaveLength(1)
    expect(events[0]?.conversion).toBe('original')
  })

  it('2. conversion().withResponsiveImages() (nonQueued) generates variants for that conversion', async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root } } },
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

    const dir = responsiveDir(media.id)
    expect(existsSync(dir)).toBe(true)
    const files = readdirSync(dir)
    const previewFiles = files.filter((f) => /___preview_\d+_\d+\.webp$/.test(f))
    expect(previewFiles.length).toBeGreaterThan(0)

    const updated = await repo.findById(media.id)
    expect(updated?.responsiveImages.preview).toBeDefined()
    expect(updated?.generatedConversions.preview).toBe(true)
  })

  it('3. responsivePlaceholders: false omits the placeholder key', async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root } } },
      responsivePlaceholders: false,
      models: {
        Post: { collections: { images: collection().withResponsiveImages() } },
      },
    })

    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    const updated = await repo.findById(media.id)
    const entry = updated?.responsiveImages.original as { files: unknown[]; placeholder?: string }
    expect(entry).toBeDefined()
    expect('placeholder' in entry).toBe(false)
  })

  it('4. media with no responsive opt-in anywhere generates nothing', async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root } } },
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

    const updated = await repo.findById(media.id)
    expect(updated?.responsiveImages).toEqual({})
    expect(existsSync(responsiveDir(media.id))).toBe(false)
  })

  it("5. perform(mediaId, ['original']) regenerates the entry via the sentinel path", async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root } } },
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

    await library.performConversions(media.id, ['original'])

    const regenerated = await repo.findById(media.id)
    expect(regenerated?.responsiveImages.original).toBeDefined()
    const entry = regenerated?.responsiveImages.original as { files: unknown[] }
    expect(entry.files.length).toBeGreaterThan(0)
  })

  it('6. FileAdder.withResponsiveImages() (per-add, plain default collection) triggers original variants', async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root } } },
      models: { Post: {} },
    })

    const media = await library
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('photo.jpg')
      .withResponsiveImages()
      .toCollection()

    const dir = responsiveDir(media.id)
    expect(existsSync(dir)).toBe(true)
    const files = readdirSync(dir)
    expect(files.some((f) => /___original_\d+_\d+\.jpe?g$/.test(f))).toBe(true)

    const updated = await repo.findById(media.id)
    expect(updated?.responsiveImages.original).toBeDefined()
  })

  it('exercises the MediaEventMap responsive:generated typing', () => {
    const payload: MediaEventMap['responsive:generated'] = {
      media: {} as MediaEventMap['responsive:generated']['media'],
      conversion: 'original',
    }
    expect(payload.conversion).toBe('original')
  })

  it('routes original responsive generation through toSourceImage when the generator provides it', async () => {
    let sourceCalls = 0
    const fakeGenerator: ImageGenerator = {
      supports: (mime) => mime === 'application/x-fake',
      toImage: async () => buildJpegFixture(400, 300),
      toSourceImage: async () => {
        sourceCalls += 1
        return buildJpegFixture(800, 600)
      },
    }

    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root } } },
      imageGenerators: [fakeGenerator],
      models: {
        Post: { collections: { images: collection().withResponsiveImages() } },
      },
    })

    const tinySource = await buildJpegFixture(10, 10)
    const media = await library.for('Post', 1).add(tinySource).usingFileName('photo.jpg').toCollection('images')

    await repo.update(media.id, { mimeType: 'application/x-fake', responsiveImages: { requested: true } })

    await library.performConversions(media.id, ['original'])

    expect(sourceCalls).toBe(1)
    const updated = await repo.findById(media.id)
    const entry = updated?.responsiveImages.original as { files: Array<{ width: number }> }
    expect(entry).toBeDefined()
    expect(entry.files.length).toBeGreaterThan(0)
    // Widths must derive from the 800px toSourceImage output, not the 10px original.
    expect(entry.files[0]!.width).toBe(800)
  })

  it('generators without toSourceImage keep the raw-original behavior', async () => {
    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root } } },
      models: {
        Post: { collections: { images: collection().withResponsiveImages() } },
      },
    })

    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    const updated = await repo.findById(media.id)
    const entry = updated?.responsiveImages.original as { files: Array<{ width: number }> }
    expect(entry).toBeDefined()
    expect(entry.files.length).toBeGreaterThan(0)

    const uploadedMeta = await sharp(jpeg).metadata()
    expect(entry.files[0]!.width).toBe(uploadedMeta.width)
  })

  it('original-responsive variants for a toSourceImage generator are named/encoded .png, not the source extension', async () => {
    const fakeGenerator: ImageGenerator = {
      supports: (mime) => mime === 'application/x-fake',
      toImage: async () => buildJpegFixture(400, 300),
      toSourceImage: async () => buildJpegFixture(800, 600),
    }

    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root } } },
      imageGenerators: [fakeGenerator],
      models: {
        Post: { collections: { images: collection().withResponsiveImages() } },
      },
    })

    const tinySource = await buildJpegFixture(10, 10)
    const media = await library.for('Post', 1).add(tinySource).usingFileName('doc.pdf').toCollection('images')

    await repo.update(media.id, { mimeType: 'application/x-fake', responsiveImages: { requested: true } })
    await library.performConversions(media.id, ['original'])

    const dir = responsiveDir(media.id)
    const files = readdirSync(dir)
    expect(files.length).toBeGreaterThan(0)
    for (const fileName of files) {
      expect(fileName).toMatch(/___original_\d+_\d+\.png$/)
    }

    const updated = await repo.findById(media.id)
    const entry = updated?.responsiveImages.original as { files: Array<{ fileName: string }> }
    expect(entry.files.length).toBeGreaterThan(0)
    for (const variant of entry.files) {
      expect(files).toContain(variant.fileName)
    }
  })

  it('a format:null conversion on a toSourceImage generator writes -<name>.png on disk and resolves the conversion URL to that same file', async () => {
    const fakeGenerator: ImageGenerator = {
      supports: (mime) => mime === 'application/x-fake',
      toImage: async () => buildJpegFixture(400, 300),
      toSourceImage: async () => buildJpegFixture(800, 600),
    }

    const library = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root, baseUrl: 'https://cdn.test' } } },
      imageGenerators: [fakeGenerator],
      models: {
        Post: {
          collections: {
            images: collection().conversions({
              thumb: conversion().width(50).nonQueued(),
            }),
          },
        },
      },
    })

    const tinySource = await buildJpegFixture(10, 10)
    const media = await library.for('Post', 1).add(tinySource).usingFileName('doc.pdf').toCollection('images')

    await repo.update(media.id, { mimeType: 'application/x-fake' })
    await library.performConversions(media.id, ['thumb'])

    const conversionsDir = join(root, media.id, 'conversions')
    const files = readdirSync(conversionsDir)
    expect(files).toContain('doc-thumb.png')

    const refreshed = await repo.findById(media.id)
    expect(refreshed).toBeDefined()
    const url = await library.urlGenerator.url(refreshed!, 'thumb')
    expect(url).toContain('doc-thumb.png')
  })

  it('regenerating original responsive with a shrunk variant plan deletes the stale (no-longer-produced) files', async () => {
    const storage = { disks: { default: { driver: 'fs' as const, root } } }

    const library = createMediaLibrary({
      repository: repo,
      storage,
      models: {
        Post: { collections: { images: collection().withResponsiveImages() } },
      },
    })

    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    const dir = responsiveDir(media.id)
    const originalFiles = readdirSync(dir)
    expect(originalFiles.length).toBeGreaterThan(1)

    // A second library over the same repo + storage, but with a width
    // calculator that only ever produces a single width — shrinking the
    // variant plan for a regenerate.
    const library2 = createMediaLibrary({
      repository: repo,
      storage,
      responsiveWidthCalculator: { calculateWidths: () => [200] },
      models: {
        Post: { collections: { images: collection().withResponsiveImages() } },
      },
    })

    await library2.performConversions(media.id, ['original'])

    const updated = await repo.findById(media.id)
    const entry = updated?.responsiveImages.original as { files: Array<{ fileName: string }> }
    expect(entry.files.length).toBe(1)

    const afterFiles = readdirSync(dir)
    expect(afterFiles.sort()).toEqual(entry.files.map((f) => f.fileName).sort())
  })

  it("emits 'responsive:failed' (warn path) when the original width calculator throws but a conversion still succeeds", async () => {
    const storage = { disks: { default: { driver: 'fs' as const, root } } }
    const models = {
      Post: {
        collections: {
          images: collection()
            .withResponsiveImages()
            .conversions({
              thumb: conversion().width(50).nonQueued(),
            }),
        },
      },
    }

    const library = createMediaLibrary({ repository: repo, storage, models })
    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    const library2 = createMediaLibrary({
      repository: repo,
      storage,
      responsiveWidthCalculator: {
        calculateWidths: () => {
          throw new Error('boom')
        },
      },
      models,
    })

    const failures: Array<{ conversion: string; error: unknown }> = []
    library2.events.on('responsive:failed', (p) => failures.push(p))

    await expect(library2.performConversions(media.id)).resolves.toBeUndefined()

    expect(failures).toHaveLength(1)
    expect(failures[0]?.conversion).toBe('original')
    expect(failures[0]?.error).toBeInstanceOf(Error)

    const updated = await repo.findById(media.id)
    expect(updated?.generatedConversions.thumb).toBe(true)
  })

  it("emits 'responsive:failed' (rethrow path) and rejects when the original width calculator throws with no fallback conversions", async () => {
    const storage = { disks: { default: { driver: 'fs' as const, root } } }
    const models = {
      Post: { collections: { images: collection().withResponsiveImages() } },
    }

    const library = createMediaLibrary({ repository: repo, storage, models })
    const media = await library.for('Post', 1).add(jpeg).usingFileName('photo.jpg').toCollection('images')

    const library2 = createMediaLibrary({
      repository: repo,
      storage,
      responsiveWidthCalculator: {
        calculateWidths: () => {
          throw new Error('boom')
        },
      },
      models,
    })

    const failures: Array<{ conversion: string; error: unknown }> = []
    library2.events.on('responsive:failed', (p) => failures.push(p))

    await expect(library2.performConversions(media.id, ['original'])).rejects.toThrow('boom')

    expect(failures).toHaveLength(1)
    expect(failures[0]?.conversion).toBe('original')
  })
})
