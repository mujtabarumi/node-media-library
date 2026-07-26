import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMediaLibrary, MediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { DisallowedExtensionError, UnacceptableFileError } from '../src/errors.js'
import type { MediaRecord } from '../src/types.js'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const png = Buffer.from(PNG_BASE64, 'base64')

let root: string
let library: MediaLibrary
let repo: InMemoryMediaRepository

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nml-adder-'))
  repo = new InMemoryMediaRepository()
  library = createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root } } },
    models: {
      User: {
        collections: {
          avatar: collection().singleFile().acceptsMimeTypes(['image/*']),
          gallery: collection().onlyKeepLatest(2),
        },
      },
    },
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('FileAdder', () => {
  it('stores file on disk and creates record', async () => {
    const m = await library.for('User', 1).add(png).usingName('Avatar').toCollection('avatar')
    expect(m.mimeType).toBe('image/png')
    expect(m.collectionName).toBe('avatar')
    expect(existsSync(join(root, m.id, m.fileName))).toBe(true)
  })

  it('rejects a disallowed extension even when the mime type would be accepted', async () => {
    await expect(
      library.for('User', 1).add(png).usingFileName('x.php.png').toCollection('avatar'),
    ).rejects.toThrow(DisallowedExtensionError)
  })

  it('rejects a file whose sniffed mime does not satisfy acceptsMimeTypes', async () => {
    await expect(
      library.for('User', 1).add(Buffer.from('plain text')).toCollection('avatar'),
    ).rejects.toThrow(UnacceptableFileError)
  })

  it('singleFile collection keeps only the newest record and removes the old one from disk', async () => {
    const first = await library.for('User', 1).add(png).toCollection('avatar')
    await library.for('User', 1).add(png).toCollection('avatar')

    const all = await repo.findForModel('User', '1', 'avatar')
    expect(all.length).toBe(1)
    expect(existsSync(join(root, first.id))).toBe(false)
  })

  it('onlyKeepLatest(2) collection keeps the two newest records and deletes the oldest', async () => {
    const first = await library.for('User', 1).add(png).toCollection('gallery')
    await library.for('User', 1).add(png).toCollection('gallery')
    await library.for('User', 1).add(png).toCollection('gallery')

    const all = await repo.findForModel('User', '1', 'gallery')
    expect(all.length).toBe(2)
    expect(all.some((r) => r.id === first.id)).toBe(false)
  })

  it('moves a path source by default and preserves it with preservingOriginal()', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nml-source-'))
    const movedPath = join(dir, 'moved.png')
    const keptPath = join(dir, 'kept.png')
    await writeFile(movedPath, png)
    await writeFile(keptPath, png)

    try {
      await library.for('User', 2).add(movedPath).toCollection('default')
      expect(existsSync(movedPath)).toBe(false)

      await library.for('User', 2).add(keptPath).preservingOriginal().toCollection('default')
      expect(existsSync(keptPath)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('emits media:added with the created record', async () => {
    const captured: MediaRecord[] = []
    library.events.on('media:added', ({ media }) => captured.push(media))

    const created = await library.for('User', 3).add(png).toCollection('default')

    expect(captured).toHaveLength(1)
    expect(captured[0]).toEqual(created)
  })
})
