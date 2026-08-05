/**
 * Backs the "Importing from a URL" page.
 *
 * examples/test/url-import.test.ts exercises the rejection paths — a
 * non-allowlisted host, a port mismatch, a non-HTTP protocol — none of which
 * touch the network, because the check runs before the fetch. The happy path
 * is deliberately not tested: a test that downloads from the public internet
 * is a flaky test.
 */
import { createMediaLibrary, InMemoryMediaRepository, collection } from '@node-media-library/core'

export function createLibrary(storageRoot = './storage/media') {
  return createMediaLibrary({
    repository: new InMemoryMediaRepository(),
    storage: {
      disks: {
        default: { driver: 'fs', root: storageRoot, baseUrl: 'http://localhost:3000/media' },
      },
    },
    models: {
      User: { collections: { avatar: collection().singleFile().acceptsMimeTypes(['image/*']) } },
    },
  })
}

// #region import
export async function importAvatar(
  library: ReturnType<typeof createLibrary>,
  userId: string,
  url: string,
) {
  return library
    .for('User', userId)
    .add({ url, allowedHosts: ['cdn.partner.com'] })
    .usingName('Imported photo')
    .toCollection('avatar')
}
// #endregion import
