import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection, DEFAULT_COLLECTION } from '../src/definitions/collection.js'
import { UnknownModelError } from '../src/errors.js'

function makeLibrary() {
  const root = mkdtempSync(join(tmpdir(), 'ml-'))
  return createMediaLibrary({
    repository: new InMemoryMediaRepository(),
    storage: { disks: { default: { driver: 'fs', root } } },
    models: {
      User: {
        collections: {
          avatar: collection().singleFile(),
        },
      },
    },
  })
}

describe('createMediaLibrary', () => {
  it('throws UnknownModelError for unregistered model types', () => {
    const library = makeLibrary()
    expect(() => library.for('Ghost', 1)).toThrow(UnknownModelError)
  })

  it('returns a handle for a registered model type', () => {
    const library = makeLibrary()
    const handle = library.for('User', 42)
    expect(handle).toBeDefined()
    expect(handle.modelType).toBe('User')
  })

  it('returns the registered collection definition, else DEFAULT_COLLECTION for ad-hoc names', () => {
    const library = makeLibrary()
    expect(library.getCollectionDefinition('User', 'avatar').singleFile).toBe(true)
    expect(library.getCollectionDefinition('User', 'anything-else')).toBe(DEFAULT_COLLECTION)
  })

  it('coerces numeric modelId to string', () => {
    const library = makeLibrary()
    const handle = library.for('User', 42)
    expect(handle.modelId).toBe('42')
  })

  it('clearFor deletes the records and emits collection:cleared, same as handle.clear()', async () => {
    const library = makeLibrary()
    const media = await library.for('User', 42).add(Buffer.from('avatar bytes')).toCollection('avatar')

    const events: Array<{ modelType: string; modelId: string; collection: string }> = []
    library.events.on('collection:cleared', (payload) => events.push(payload))

    await library.clearFor('User', 42, 'avatar')

    expect(await library.repository.findById(media.id)).toBeNull()
    expect(events).toEqual([{ modelType: 'User', modelId: '42', collection: 'avatar' }])
  })

  it('clearFor with an omitted collection still clears every collection for that model', async () => {
    const library = makeLibrary()
    const inAvatar = await library.for('User', 1).add(Buffer.from('a')).toCollection('avatar')
    const inGallery = await library.for('User', 1).add(Buffer.from('b')).toCollection('gallery')

    const events: Array<{ modelType: string; modelId: string; collection: string }> = []
    library.events.on('collection:cleared', (payload) => events.push(payload))

    await library.clearFor('User', 1)

    expect(await library.repository.findById(inAvatar.id)).toBeNull()
    expect(await library.repository.findById(inGallery.id)).toBeNull()
    expect(events).toEqual([{ modelType: 'User', modelId: '1', collection: '*' }])
  })

  it('exposes registered model types', () => {
    expect(makeLibrary().modelTypes).toEqual(['User'])
  })
})
