import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { StorageError } from '../src/errors.js'
import type { UrlGenerator } from '../src/storage/url-generator.js'

afterEach(() => vi.restoreAllMocks())

const r2 = (baseUrl?: string) => ({
  driver: 'r2' as const,
  accountId: 'acct',
  bucket: 'b',
  ...(baseUrl ? { baseUrl } : {}),
})

/** A consumer's own generator — core cannot see how it builds public URLs. */
const customUrlGenerator: UrlGenerator = {
  url: async (media, conversionName) =>
    `https://my-cdn.example/${media.id}${conversionName ? `/${conversionName}` : ''}`,
  signedUrl: async (media) => `https://my-cdn.example/${media.id}?sig=x`,
  responsiveUrl: async (media, fileName) => `https://my-cdn.example/${media.id}/r/${fileName}`,
}

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

  it('warns instead of throwing when a custom urlGenerator is configured', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: r2() } },
        models: { post: { collections: { images: collection().public() } } },
        urlGenerator: customUrlGenerator,
      }),
    ).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('custom urlGenerator'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"images"'))
  })

  it('still emits the mixed-visibility warning with a custom urlGenerator', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createMediaLibrary({
      repository: new InMemoryMediaRepository(),
      storage: { disks: { default: r2('https://cdn.example.com') } },
      models: { post: { collections: { images: collection().public(), docs: collection() } } },
      urlGenerator: customUrlGenerator,
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no per-object ACLs'))
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

describe('public URLs on a bare r2 disk', () => {
  const fakeMedia = () =>
    ({
      id: 'abc',
      fileName: 'cat.png',
      disk: 'default',
      conversionsDisk: null,
      generatedConversions: {},
      responsiveImages: { thumb: { files: [{ fileName: 'cat-thumb-100x50.png', width: 100 }] } },
      modelType: 'post',
      modelId: '1',
      collectionName: 'docs',
      updatedAt: new Date(0),
    }) as never

  // The construction-time check only covers `.public()` collections. A private
  // or unregistered collection on a bare r2 disk reaches `publicUrlFor`, where
  // `disk.getUrl()` would return the authenticated S3 API host — a link that
  // 401s for anonymous readers, handed straight into a template.
  const library = () =>
    createMediaLibrary({
      repository: new InMemoryMediaRepository(),
      storage: { disks: { default: r2() } },
      models: { post: { collections: { docs: collection() } } },
    })

  it('url() throws rather than returning the r2.cloudflarestorage.com API host', async () => {
    await expect(library().urlGenerator.url(fakeMedia())).rejects.toThrow(StorageError)
  })

  it('names the disk and points at signedUrl()', async () => {
    await expect(library().urlGenerator.url(fakeMedia())).rejects.toThrow(
      /"default".*no baseUrl[\s\S]*signedUrl\(\)/,
    )
  })

  it('responsiveUrl() throws too — it shares publicUrlFor', async () => {
    await expect(
      library().urlGenerator.responsiveUrl!(fakeMedia(), 'cat-thumb-100x50.png'),
    ).rejects.toThrow(StorageError)
  })

  it('srcset() propagates rather than emitting dead links', async () => {
    await expect(library().srcset(fakeMedia(), 'thumb')).rejects.toThrow(StorageError)
  })

  it('an r2 disk WITH baseUrl is unaffected', async () => {
    const lib = createMediaLibrary({
      repository: new InMemoryMediaRepository(),
      storage: { disks: { default: r2('https://cdn.example.com') } },
      models: { post: { collections: { docs: collection() } } },
    })
    expect(await lib.urlGenerator.url(fakeMedia())).toBe('https://cdn.example.com/abc/cat.png')
  })
})
