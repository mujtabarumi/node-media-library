import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import yauzl from 'yauzl'
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { MediaLibraryError } from '../src/errors.js'
import { zipEntryName, sanitizeZipPrefix } from '../src/downloads/zip.js'

/** Entry-name → content map, via yauzl (buffer mode). */
function readZip(buffer: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err)
      const entries = new Map<string, Buffer>()
      zip.on('entry', (entry) => {
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return reject(streamErr)
          const chunks: Buffer[] = []
          stream.on('data', (c) => chunks.push(c))
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks))
            zip.readEntry()
          })
        })
      })
      zip.on('end', () => resolve(entries))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

let root: string
let repo: InMemoryMediaRepository
let jpegA: Buffer
let jpegB: Buffer

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'nml-zip-'))
  repo = new InMemoryMediaRepository()
  jpegA = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer()
  jpegB = await sharp({
    create: { width: 20, height: 15, channels: 3, background: { r: 200, g: 50, b: 10 } },
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
          images: collection(),
        },
      },
    },
  })
}

describe('zip', () => {
  it('1. zip(archiveName, items) streams a ZIP with the correct headers and entry bytes', async () => {
    const library = buildLibrary()
    const mediaA = await library.for('Post', 1).add(jpegA).usingFileName('a.jpg').toCollection('images')
    const mediaB = await library.for('Post', 1).add(jpegB).usingFileName('b.jpg').toCollection('images')

    const response = await library.zip('archive.zip', [mediaA.id, mediaB.id])

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="archive.zip"')

    const entries = await readZip(Buffer.from(await response.arrayBuffer()))
    expect(entries.size).toBe(2)
    expect(entries.get('a.jpg')?.equals(jpegA)).toBe(true)
    expect(entries.get('b.jpg')?.equals(jpegB)).toBe(true)
  })

  it('2. zipFilenamePrefix from customProperties folders the entry', async () => {
    const library = buildLibrary()
    const mediaA = await library.for('Post', 1).add(jpegA).usingFileName('a.jpg').toCollection('images')
    const jpegC = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg({ quality: 90 })
      .toBuffer()
    const mediaC = await library
      .for('Post', 1)
      .add(jpegC)
      .usingFileName('c.jpg')
      .withCustomProperties({ zipFilenamePrefix: 'photos/' })
      .toCollection('images')

    const response = await library.zip('archive.zip', [mediaA.id, mediaC.id])
    const entries = await readZip(Buffer.from(await response.arrayBuffer()))

    expect(entries.has('a.jpg')).toBe(true)
    expect(entries.has(`photos/${mediaC.fileName}`)).toBe(true)
    expect(entries.get(`photos/${mediaC.fileName}`)?.equals(jpegC)).toBe(true)
  })

  it('3. duplicate entry names get deduplicated with -2, -3, ...', async () => {
    const library = buildLibrary()
    const mediaA1 = await library.for('Post', 1).add(jpegA).usingFileName('a.jpg').toCollection('images')
    const mediaA2 = await library.for('Post', 1).add(jpegB).usingFileName('a.jpg').toCollection('images')

    const response = await library.zip('archive.zip', [mediaA1.id, mediaA2.id])
    const entries = await readZip(Buffer.from(await response.arrayBuffer()))

    expect(entries.size).toBe(2)
    expect(entries.get('a.jpg')?.equals(jpegA)).toBe(true)
    expect(entries.get('a-2.jpg')?.equals(jpegB)).toBe(true)
  })

  it('4. zip with an unknown id rejects with MediaLibraryError before streaming', async () => {
    const library = buildLibrary()
    const mediaA = await library.for('Post', 1).add(jpegA).usingFileName('a.jpg').toCollection('images')

    await expect(library.zip('archive.zip', [mediaA.id, 'nope'])).rejects.toThrow(MediaLibraryError)
  })

  it('6. entry streams open lazily — disk.getStream() is not called until the archive actually reads that entry', async () => {
    const library = buildLibrary()
    const mediaA = await library.for('Post', 1).add(jpegA).usingFileName('a.jpg').toCollection('images')
    const mediaB = await library.for('Post', 1).add(jpegB).usingFileName('b.jpg').toCollection('images')

    const disk = await library.storage.disk('default')
    const originalGetStream = disk.getStream.bind(disk)
    const getStreamCalls: string[] = []
    disk.getStream = (async (key: string) => {
      getStreamCalls.push(key)
      return originalGetStream(key)
    }) as typeof disk.getStream

    const response = await library.zip('archive.zip', [mediaA.id, mediaB.id])

    // If entries were opened eagerly (old behavior), both getStream() calls
    // would already have happened by the time zip() resolves — before the
    // archive has been read at all.
    expect(getStreamCalls).toEqual([])

    const entries = await readZip(Buffer.from(await response.arrayBuffer()))

    expect(entries.size).toBe(2)
    expect(getStreamCalls.length).toBe(2)
  })

  describe('zipEntryName (pure)', () => {
    it('5a. no collision: passthrough of prefix + fileName', () => {
      const taken = new Set<string>()
      expect(zipEntryName('a.jpg', '', taken)).toBe('a.jpg')
      expect(taken.has('a.jpg')).toBe(true)
    })

    it('5b. collision inserts -2 before the extension', () => {
      const taken = new Set<string>(['a.jpg'])
      expect(zipEntryName('a.jpg', '', taken)).toBe('a-2.jpg')
      expect(taken.has('a-2.jpg')).toBe(true)
    })

    it('5b-cont. repeated collisions increment further', () => {
      const taken = new Set<string>(['a.jpg', 'a-2.jpg'])
      expect(zipEntryName('a.jpg', '', taken)).toBe('a-3.jpg')
    })

    it('5c. extensionless collision: file -> file-2', () => {
      const taken = new Set<string>(['file'])
      expect(zipEntryName('file', '', taken)).toBe('file-2')
    })

    it('5d. prefix is applied verbatim and preserved through collisions', () => {
      const taken = new Set<string>(['photos/a.jpg'])
      expect(zipEntryName('a.jpg', 'photos/', taken)).toBe('photos/a-2.jpg')
    })

    it('5e. a zip-slip prefix ("../../etc/") has its ".." segments dropped', () => {
      const taken = new Set<string>()
      expect(zipEntryName('a.jpg', '../../etc/', taken)).toBe('etc/a.jpg')
    })

    it('5f. a leading-slash prefix is not treated as archive-root-absolute', () => {
      const taken = new Set<string>()
      expect(zipEntryName('a.jpg', '/etc/', taken)).toBe('etc/a.jpg')
    })

    it('5g. backslashes in the prefix are dropped, not treated as separators', () => {
      const taken = new Set<string>()
      expect(zipEntryName('a.jpg', '..\\..\\etc\\', taken)).toBe('....etca.jpg')
    })
  })

  describe('sanitizeZipPrefix (pure)', () => {
    it('strips leading slashes, drops "." and ".." segments, and removes backslashes', () => {
      expect(sanitizeZipPrefix('../../etc/')).toBe('etc/')
      expect(sanitizeZipPrefix('/etc/passwd/')).toBe('etc/passwd/')
      expect(sanitizeZipPrefix('photos/')).toBe('photos/')
      expect(sanitizeZipPrefix('./photos/')).toBe('photos/')
      expect(sanitizeZipPrefix('')).toBe('')
    })
  })
})
