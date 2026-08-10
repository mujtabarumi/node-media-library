import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { StorageError } from '../src/errors.js'

afterEach(() => vi.restoreAllMocks())

const r2 = (baseUrl?: string) => ({
  driver: 'r2' as const,
  accountId: 'acct',
  bucket: 'b',
  ...(baseUrl ? { baseUrl } : {}),
})

describe('public collections on r2 disks', () => {
  it('throws when a public collection targets an r2 disk with no baseUrl', () => {
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: r2() } },
        models: { post: { collections: { images: collection().public() } } },
      }),
    ).toThrow(StorageError)
  })

  it('names the collection, the model and the disk in the error', () => {
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: r2() } },
        models: { post: { collections: { images: collection().public() } } },
      }),
    ).toThrow(/"images".*"post".*"default"/s)
  })

  it('accepts a public collection when baseUrl is set', () => {
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: r2('https://cdn.example.com') } },
        models: { post: { collections: { images: collection().public() } } },
      }),
    ).not.toThrow()
  })

  it('catches a public collection whose conversionsDisk is the bare r2 disk', () => {
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { cdn: r2('https://cdn.example.com'), raw: r2() }, default: 'cdn' },
        models: {
          post: { collections: { images: collection().public().storeConversionsOnDisk('raw') } },
        },
      }),
    ).toThrow(StorageError)
  })

  it('leaves private collections on a bare r2 disk alone', () => {
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: r2() } },
        models: { post: { collections: { images: collection() } } },
      }),
    ).not.toThrow()
  })

  it('warns when one r2 disk with baseUrl serves both public and private collections', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createMediaLibrary({
      repository: new InMemoryMediaRepository(),
      storage: { disks: { default: r2('https://cdn.example.com') } },
      models: { post: { collections: { images: collection().public(), docs: collection() } } },
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[media-library]'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('default'))
  })

  it('does not warn when public and private live on separate r2 disks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createMediaLibrary({
      repository: new InMemoryMediaRepository(),
      storage: { disks: { pub: r2('https://cdn.example.com'), priv: r2() }, default: 'priv' },
      models: {
        post: { collections: { images: collection().public().useDisk('pub'), docs: collection() } },
      },
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores collections pointing at a disk name that is not configured', () => {
    // diskConfig() throws for unknown names. That is a pre-existing runtime
    // failure mode this check must not convert into a construction failure.
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: r2('https://cdn.example.com') } },
        models: { post: { collections: { images: collection().useDisk('nonexistent') } } },
      }),
    ).not.toThrow()
  })
})
