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
})
