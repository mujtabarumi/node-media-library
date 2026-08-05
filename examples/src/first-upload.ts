/**
 * Backs the code on the "Your first upload" documentation page.
 *
 * The `// #region` markers below are what the site embeds — edit them and the
 * page changes with them. Everything here runs in CI, so a snippet that stops
 * compiling or stops behaving as described fails the build rather than
 * quietly misleading a reader.
 *
 * `storageRoot` is a defaulted parameter so the documented call is a bare
 * `createLibrary()` while the test can point it at a temp directory.
 */
import {
  createMediaLibrary,
  InMemoryMediaRepository,
  collection,
  conversion,
} from '@node-media-library/core'

// #region config
export function createLibrary(storageRoot = './storage/media') {
  return createMediaLibrary({
    repository: new InMemoryMediaRepository(),
    storage: {
      disks: {
        default: {
          driver: 'fs',
          root: storageRoot,
          // Required. The fs driver cannot know your public URL, so url()
          // throws without this. Point it at the path your server serves
          // `storageRoot` from.
          baseUrl: 'http://localhost:3000/media',
        },
      },
    },
    models: {
      User: {
        collections: {
          avatar: collection()
            .singleFile()
            .acceptsMimeTypes(['image/*'])
            .conversions({
              // nonQueued() runs it inline, so the URL is valid the moment
              // add() resolves
              thumb: conversion().width(96).height(96).fit('cover').format('webp').nonQueued(),
            }),
        },
      },
    },
  })
}
// #endregion config

// #region usage
export async function storeAvatar(library: ReturnType<typeof createLibrary>, uploadPath: string) {
  const media = await library.for('User', 'user-1').add(uploadPath).toCollection('avatar')

  media.id //  '0e5f…'    — the media record id
  media.mimeType //  'image/png' — sniffed from the bytes, not the filename

  return media
}
// #endregion usage

// #region read-back
export async function avatarUrls(library: ReturnType<typeof createLibrary>) {
  const original = await library.for('User', 'user-1').firstUrl('avatar')
  const thumb = await library.for('User', 'user-1').firstUrl('avatar', 'thumb')

  return { original, thumb }
}
// #endregion read-back
