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
import { conversionKey } from '../src/conversions/naming.js'
import { DefaultPathGenerator } from '../src/storage/path-generator.js'
import type { MediaRecord } from '../src/types.js'
import type { ImageOptimizer, OptimizeContext } from '../src/conversions/optimizer.js'

let root: string
let repo: InMemoryMediaRepository
let pngBuffer: Buffer

/** Deterministic optimizer: strips the last byte, so the effect on stored
 * byte length is exactly predictable and comparable against a plain library. */
function shrinker(name: string, calls: OptimizeContext[]): ImageOptimizer {
  return {
    name,
    async optimize(buffer, ctx) {
      calls.push(ctx)
      return buffer.subarray(0, buffer.length - 1)
    },
  }
}

function makeLibrary(options: { optimizers?: ImageOptimizer[] } = {}): MediaLibrary {
  return createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root } } },
    models: {
      post: {
        collections: {
          default: collection().conversions({
            thumb: conversion().width(20).height(20),
          }),
        },
      },
    },
    optimizers: options.optimizers ?? [],
  })
}

async function readConversionBytes(
  library: MediaLibrary,
  media: MediaRecord,
  conversionName: string,
): Promise<Buffer> {
  const pathGen = new DefaultPathGenerator()
  const def = library.getCollectionDefinition(media.modelType, media.collectionName).conversions[conversionName]!
  const key = conversionKey(media, pathGen, def, conversionName)
  const disk = await library.storage.disk(media.conversionsDisk ?? media.disk)
  const bytes = await disk.getBytes(key)
  return Buffer.from(bytes)
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'nml-optimizer-'))
  repo = new InMemoryMediaRepository()
  pngBuffer = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 40, g: 120, b: 200 } },
  })
    .png()
    .toBuffer()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ImageOptimizer seam', () => {
  it('optimizer output is what lands on disk for conversions', async () => {
    const calls: OptimizeContext[] = []
    const library = makeLibrary({ optimizers: [shrinker('s', calls)] })
    const media = await library.for('post', '1').add(pngBuffer).toCollection('default')

    // sync queue driver: conversions already ran
    const record = (await library.repository.findById(media.id))!
    expect(record.generatedConversions['thumb']).toBe(true)
    expect(calls.some((c) => c.kind === 'conversion' && c.fileName.includes('thumb'))).toBe(true)

    // stored bytes are exactly one byte shorter than what a no-optimizer
    // library writes
    const plain = makeLibrary({ optimizers: [] })
    const plainMedia = await plain.for('post', '1').add(pngBuffer).toCollection('default')
    const optimizedBytes = await readConversionBytes(library, record, 'thumb')
    const plainBytes = await readConversionBytes(plain, plainMedia, 'thumb')
    expect(optimizedBytes.length).toBe(plainBytes.length - 1)
  })

  it('a larger result is rejected', async () => {
    const grower: ImageOptimizer = {
      name: 'g',
      async optimize(buffer) {
        return Buffer.concat([buffer, Buffer.from([0])])
      },
    }
    const library = makeLibrary({ optimizers: [grower] })
    const media = await library.for('post', '1').add(pngBuffer).toCollection('default')

    const plain = makeLibrary({ optimizers: [] })
    const plainMedia = await plain.for('post', '1').add(pngBuffer).toCollection('default')

    const bytes = await readConversionBytes(library, media, 'thumb')
    const plainBytes = await readConversionBytes(plain, plainMedia, 'thumb')
    expect(bytes).toEqual(plainBytes)
  })

  it('a throwing optimizer warns and never fails the conversion', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const boom: ImageOptimizer = {
      name: 'boom',
      async optimize() {
        throw new Error('boom')
      },
    }
    const library = makeLibrary({ optimizers: [boom] })
    const media = await library.for('post', '1').add(pngBuffer).toCollection('default')

    const record = (await library.repository.findById(media.id))!
    expect(record.generatedConversions['thumb']).toBe(true)
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('null return passes through unchanged', async () => {
    const passthrough: ImageOptimizer = {
      name: 'passthrough',
      async optimize() {
        return null
      },
    }
    const library = makeLibrary({ optimizers: [passthrough] })
    const media = await library.for('post', '1').add(pngBuffer).toCollection('default')

    const plain = makeLibrary({ optimizers: [] })
    const plainMedia = await plain.for('post', '1').add(pngBuffer).toCollection('default')

    const bytes = await readConversionBytes(library, media, 'thumb')
    const plainBytes = await readConversionBytes(plain, plainMedia, 'thumb')
    expect(bytes).toEqual(plainBytes)
  })

  it('responsive variants are optimized too (kind: "responsive")', async () => {
    const calls: OptimizeContext[] = []
    const responsiveLibrary = createMediaLibrary({
      repository: repo,
      storage: { disks: { default: { driver: 'fs', root } } },
      models: {
        post: {
          collections: {
            default: collection().conversions({
              thumb: conversion().width(60).height(60).withResponsiveImages(),
            }),
          },
        },
      },
      optimizers: [shrinker('s', calls)],
    })

    const bigPng = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 200, b: 30 } },
    })
      .png()
      .toBuffer()

    await responsiveLibrary.for('post', '1').add(bigPng).toCollection('default')

    expect(calls.some((c) => c.kind === 'conversion')).toBe(true)
    expect(calls.some((c) => c.kind === 'responsive')).toBe(true)
  })
})
