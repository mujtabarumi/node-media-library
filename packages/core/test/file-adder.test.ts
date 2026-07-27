import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { mkdtemp, writeFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMediaLibrary, MediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { DisallowedExtensionError, UnacceptableFileError } from '../src/errors.js'
import type { MediaRecord } from '../src/types.js'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, unlink: vi.fn(actual.unlink) }
})

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

  it('rolls back the stored file when repository.create fails, and rethrows', async () => {
    const createSpy = vi.spyOn(repo, 'create').mockRejectedValueOnce(new Error('boom'))

    await expect(library.for('User', 4).add(png).toCollection('avatar')).rejects.toThrow('boom')

    // The disk.put() write landed before repository.create() failed; the
    // compensating delete must have removed the orphaned <root>/<id> dir.
    expect(readdirSync(root)).toEqual([])

    createSpy.mockRestore()
  })

  it('tolerates a failing unlink after the record has already been created', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nml-source-'))
    const sourcePath = join(dir, 'gone.png')
    await writeFile(sourcePath, png)

    vi.mocked(unlink).mockRejectedValueOnce(new Error('ENOENT: no such file or directory'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const captured: MediaRecord[] = []
    library.events.on('media:added', ({ media }) => captured.push(media))

    try {
      const created = await library.for('User', 5).add(sourcePath).toCollection('default')

      expect(existsSync(join(root, created.id, created.fileName))).toBe(true)
      expect(captured).toHaveLength(1)
      expect(captured[0]?.id).toBe(created.id)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy.mock.calls[0]?.[0]).toContain(sourcePath)
    } finally {
      warnSpy.mockRestore()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
