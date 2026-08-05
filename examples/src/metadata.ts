/**
 * Backs the "Metadata, copy & move" page.
 *
 * examples/test/metadata.test.ts asserts the two behaviours the page leans on
 * and that are easy to get wrong: setCustomProperty preserves sibling keys,
 * and copyMedia re-runs the target collection's rules rather than cloning
 * bytes.
 */
import {
  createMediaLibrary,
  InMemoryMediaRepository,
  collection,
  conversion,
} from '@node-media-library/core'

export function createLibrary(storageRoot = './storage/media') {
  return createMediaLibrary({
    repository: new InMemoryMediaRepository(),
    storage: {
      disks: {
        default: { driver: 'fs', root: storageRoot, baseUrl: 'http://localhost:3000/media' },
      },
    },
    models: {
      Post: {
        collections: {
          images: collection().conversions({
            thumb: conversion().width(64).height(64).fit('cover').format('webp').nonQueued(),
          }),
          // A stricter target, to show that copy honours the DESTINATION's rules
          hero: collection().singleFile().acceptsMimeTypes(['image/png']),
        },
      },
    },
  })
}

// #region attach
export async function attachImage(
  library: ReturnType<typeof createLibrary>,
  postId: string,
  file: Buffer,
) {
  return library
    .for('Post', postId)
    .add(file)
    .usingFileName('door.png')
    .withCustomProperties({
      alt: 'A blue door',
      credit: 'A. Photographer',
      featured: true,
    })
    .toCollection('images')
}
// #endregion attach

// #region update
export async function reviseAlt(
  library: ReturnType<typeof createLibrary>,
  mediaId: string,
  alt: string,
) {
  // Atomic single-key writes: sibling properties are preserved, and this is a
  // dedicated repository primitive rather than a read-modify-write of the
  // whole customProperties blob.
  await library.setCustomProperty(mediaId, 'alt', alt)
  await library.removeCustomProperty(mediaId, 'credit')
}
// #endregion update

// #region query
export async function findFeatured(library: ReturnType<typeof createLibrary>, postId: string) {
  // An object filter requires every key to deep-equal customProperties[key]
  const featured = await library.for('Post', postId).getAll('images', { featured: true })

  // A function filter is an arbitrary predicate over the record
  const large = await library.for('Post', postId).getAll('images', (m) => m.size > 1_000_000)

  return { featured, large }
}
// #endregion query

// #region copy-move
export async function republish(
  library: ReturnType<typeof createLibrary>,
  mediaId: string,
  toPostId: string,
) {
  // Both re-run the full add pipeline against the target, so the TARGET's
  // validation, disk, and collection rules apply and derived files are
  // regenerated rather than byte-copied.
  const copy = await library.copyMedia(mediaId, 'Post', toPostId, { toCollection: 'images' })

  // Copy-then-delete-source. If the copy fails, the source is untouched.
  const moved = await library.moveMedia(mediaId, 'Post', toPostId)

  return { copy, moved }
}
// #endregion copy-move
