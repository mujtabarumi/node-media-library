import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { conversion } from '../src/definitions/conversion.js'
import { MediaLibraryError } from '../src/errors.js'
import { toNodeStream, contentDisposition } from '../src/downloads/response.js'

let root: string
let repo: InMemoryMediaRepository
let jpeg: Buffer

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'nml-downloads-'))
  repo = new InMemoryMediaRepository()
  jpeg = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer()
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const baseUrl = 'http://example.test/media'

function buildLibrary() {
  return createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root, baseUrl } } },
    models: {
      Post: {
        collections: {
          images: collection().conversions({
            thumb: conversion().width(8).height(8).format('webp').nonQueued(),
          }),
        },
      },
    },
  })
}

async function readBufferFromResponse(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer())
}

describe('downloads', () => {
  it('1. download(media.id) streams the original with attachment disposition and headers', async () => {
    const library = buildLibrary()
    const media = await library
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('photo.jpg')
      .toCollection('images')

    const response = await library.download(media.id)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    expect(response.headers.get('Content-Length')).toBe(String(media.size))
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${media.fileName}"`,
    )

    const bytes = await readBufferFromResponse(response)
    expect(bytes.equals(jpeg)).toBe(true)
  })

  it('2. inline(media.id) uses an inline Content-Disposition', async () => {
    const library = buildLibrary()
    const media = await library
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('photo.jpg')
      .toCollection('images')

    const response = await library.inline(media.id)

    expect(response.headers.get('Content-Disposition')?.startsWith('inline; filename=')).toBe(true)
  })

  it('3. download(media.id, "thumb") after generation streams the conversion file', async () => {
    const library = buildLibrary()
    const media = await library
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('photo.jpg')
      .toCollection('images')

    const updated = await repo.findById(media.id)
    expect(updated?.generatedConversions['thumb']).toBe(true)

    const response = await library.download(media.id, 'thumb')

    expect(response.headers.get('Content-Type')).toBe('image/webp')
    expect(response.headers.get('Content-Length')).toBeNull()
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="photo-thumb.webp"',
    )

    const bytes = await readBufferFromResponse(response)
    const onDisk = await readFile(join(root, String(media.id), 'conversions', 'photo-thumb.webp'))
    expect(bytes.equals(onDisk)).toBe(true)
  })

  it('4. download(media.id, "thumb") before generation falls back to the original', async () => {
    const library = buildLibrary()
    const media = await library
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('photo.jpg')
      .toCollection('images')

    await repo.update(media.id, { generatedConversions: {} })

    const response = await library.download(media.id, 'thumb')

    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    expect(response.headers.get('Content-Length')).toBe(String(media.size))
    expect(response.headers.get('Content-Disposition')).toBe(
      `attachment; filename="${media.fileName}"`,
    )

    const bytes = await readBufferFromResponse(response)
    expect(bytes.equals(jpeg)).toBe(true)
  })

  it('5. download("nope") rejects with MediaLibraryError', async () => {
    const library = buildLibrary()
    await expect(library.download('nope')).rejects.toThrow(MediaLibraryError)
  })

  it('6. toNodeStream collects to the original bytes; throws on a null-body Response', async () => {
    const library = buildLibrary()
    const media = await library
      .for('Post', 1)
      .add(jpeg)
      .usingFileName('photo.jpg')
      .toCollection('images')

    const response = await library.download(media.id)
    const nodeStream = toNodeStream(response)

    const chunks: Buffer[] = []
    for await (const chunk of nodeStream) {
      chunks.push(Buffer.from(chunk))
    }
    expect(Buffer.concat(chunks).equals(jpeg)).toBe(true)

    expect(() => toNodeStream(new Response(null))).toThrow(MediaLibraryError)
  })

  it('7. contentDisposition ASCII-sanitizes the filename', () => {
    expect(contentDisposition('attachment', 'naïve "file".jpg')).toBe(
      'attachment; filename="na_ve _file_.jpg"',
    )
  })
})
