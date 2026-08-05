/**
 * Backs the code on the "Avatars & single-file collections" page.
 *
 * The `// #region` markers below are what the site embeds. Everything here
 * runs in CI — see examples/test/avatars.test.ts, which asserts the
 * replacement and fallback-resolution behavior the page describes.
 */
import {
  createMediaLibrary,
  InMemoryMediaRepository,
  collection,
  conversion,
} from '@node-media-library/core'

// #region collection
export const avatarCollection = collection()
  .singleFile()
  .acceptsMimeTypes(['image/jpeg', 'image/png', 'image/webp'])
  .fallbackUrl('https://cdn.example.com/defaults/avatar.png')
  .conversions({
    thumb: conversion().width(96).height(96).fit('cover').format('webp').nonQueued(),
    large: conversion().width(512).height(512).fit('cover').format('webp'),
  })
// #endregion collection

// #region sized-fallbacks
export const avatarWithSizedFallbacks = collection()
  .singleFile()
  .fallbackUrl('https://cdn.example.com/defaults/avatar.png')
  .fallbackUrl('https://cdn.example.com/defaults/avatar-96.png', 'thumb')
// #endregion sized-fallbacks

export function createLibrary(storageRoot = './storage/media') {
  return createMediaLibrary({
    repository: new InMemoryMediaRepository(),
    storage: {
      disks: {
        default: { driver: 'fs', root: storageRoot, baseUrl: 'http://localhost:3000/media' },
      },
    },
    models: {
      User: { collections: { avatar: avatarCollection } },
      Account: { collections: { avatar: avatarWithSizedFallbacks } },
    },
  })
}

// #region usage
export async function setAvatar(
  library: ReturnType<typeof createLibrary>,
  userId: string,
  file: Buffer,
) {
  await library.for('User', userId).add(file).usingFileName('avatar.png').toCollection('avatar')

  // Empty collection? You get the fallback, not null — templates need no
  // branching.
  return library.for('User', userId).firstUrl('avatar', 'thumb')
}
// #endregion usage
