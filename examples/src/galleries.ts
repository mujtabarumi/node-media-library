/**
 * Backs the "Galleries & responsive images" page.
 *
 * Regions here are embedded by the site; examples/test/galleries.test.ts runs
 * them. The responsive assertions are the valuable part — variant generation
 * has a lot of moving pieces (width calculation, LQIP, per-conversion opt-in)
 * and prose describing it drifts easily.
 */
import {
  createMediaLibrary,
  InMemoryMediaRepository,
  collection,
  conversion,
} from '@node-media-library/core'

// #region collection
export const galleryCollection = collection()
  .onlyKeepLatest(20)
  .acceptsMimeTypes(['image/*'])
  .withResponsiveImages() // variant set + LQIP for every original
  .conversions({
    card: conversion().width(400).height(400).fit('cover').format('webp'),
    hero: conversion().width(1600).format('webp').withResponsiveImages(),
  })
// #endregion collection

export function createLibrary(storageRoot = './storage/media') {
  return createMediaLibrary({
    repository: new InMemoryMediaRepository(),
    storage: {
      disks: {
        default: { driver: 'fs', root: storageRoot, baseUrl: 'http://localhost:3000/media' },
      },
    },
    models: { Product: { collections: { gallery: galleryCollection } } },
  })
}

// #region add
export async function addImage(
  library: ReturnType<typeof createLibrary>,
  productId: string,
  file: Buffer,
  name: string,
) {
  return library
    .for('Product', productId)
    .add(file)
    .usingName(name)
    .usingFileName(`${name.toLowerCase().replace(/\s+/g, '-')}.png`)
    .toCollection('gallery')
}
// #endregion add

// #region reorder
export async function reorderGallery(
  library: ReturnType<typeof createLibrary>,
  productId: string,
  orderedIds: string[],
) {
  // Ids not owned by this product are filtered out, so a tampered payload
  // cannot renumber another product's media.
  await library.for('Product', productId).reorder(orderedIds)

  return library.for('Product', productId).getAll('gallery')
}
// #endregion reorder

// #region srcset
export async function renderData(library: ReturnType<typeof createLibrary>, mediaId: string) {
  return {
    // 'https://…_1600_1200.png 1600w, https://…_1338_1003.png 1338w, …'
    srcset: await library.srcset(mediaId),
    // Variants of a conversion that opted in, rather than of the original
    heroSrcset: await library.srcset(mediaId, 'hero'),
    // 'data:image/svg+xml;base64,…' — inline it as a blurred background
    placeholder: await library.placeholder(mediaId),
    // Widest-first array, if you would rather build the markup yourself
    urls: await library.responsiveUrls(mediaId),
  }
}
// #endregion srcset
