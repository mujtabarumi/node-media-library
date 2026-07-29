import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMediaLibrary, MediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const pngBuffer = Buffer.from(PNG_BASE64, 'base64')

let root: string
let library: MediaLibrary
let repo: InMemoryMediaRepository

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nml-custom-props-'))
  repo = new InMemoryMediaRepository()
  library = createMediaLibrary({
    repository: repo,
    storage: { disks: { default: { driver: 'fs', root, baseUrl: 'http://localhost:9000/media' } } },
    models: {
      post: {
        collections: {
          default: collection(),
        },
      },
    },
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('MediaLibrary custom property methods', () => {
  it('setCustomProperty merges and returns the fresh record', async () => {
    const media = await library.for('post', '1').add(pngBuffer).toCollection('default')
    const updated = await library.setCustomProperty(media, 'alt', 'a cat')
    expect(updated.customProperties).toEqual({ alt: 'a cat' })
    const again = await library.setCustomProperty(media.id, 'credit', 'Jane')
    expect(again.customProperties).toEqual({ alt: 'a cat', credit: 'Jane' })
  })

  it('removeCustomProperty deletes one key', async () => {
    const media = await library
      .for('post', '1')
      .add(pngBuffer)
      .withCustomProperties({ alt: 'a cat', credit: 'Jane' })
      .toCollection('default')
    const updated = await library.removeCustomProperty(media.id, 'credit')
    expect(updated.customProperties).toEqual({ alt: 'a cat' })
  })

  it('setCustomProperty on unknown id rejects', async () => {
    await expect(library.setCustomProperty('missing', 'k', 'v')).rejects.toThrow()
  })
})
