import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createLibrary, setAvatar } from '../src/avatars.js'

const png = (width = 200, height = 200) =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .png()
    .toBuffer()

describe('Avatars & single-file collections', () => {
  it('returns the fallback URL before anything is uploaded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-avatars-fallback-'))
    const library = createLibrary(root)

    const url = await library.for('User', 'u1').firstUrl('avatar', 'thumb')
    expect(url).toBe('https://cdn.example.com/defaults/avatar.png')
  })

  it('backs a conversion-scoped lookup with the collection default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-avatars-default-'))
    const library = createLibrary(root)

    // The page's claim: .fallbackUrl(url) with no conversion name backs EVERY
    // conversion-scoped lookup, not just the bare one.
    expect(await library.for('User', 'u1').firstUrl('avatar')).toBe(
      'https://cdn.example.com/defaults/avatar.png',
    )
    expect(await library.for('User', 'u1').firstUrl('avatar', 'large')).toBe(
      'https://cdn.example.com/defaults/avatar.png',
    )
  })

  it('prefers a per-conversion fallback over the default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-avatars-sized-'))
    const library = createLibrary(root)

    expect(await library.for('Account', 'a1').firstUrl('avatar', 'thumb')).toBe(
      'https://cdn.example.com/defaults/avatar-96.png',
    )
    // A conversion with no fallback of its own still gets the default.
    expect(await library.for('Account', 'a1').firstUrl('avatar', 'large')).toBe(
      'https://cdn.example.com/defaults/avatar.png',
    )
  })

  it('serves a real URL once an avatar exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-avatars-upload-'))
    const library = createLibrary(root)

    const url = await setAvatar(library, 'u1', await png())

    expect(url).not.toBe('https://cdn.example.com/defaults/avatar.png')
    expect(url).toContain('/conversions/avatar-thumb.webp')
  })

  it('replaces rather than accumulates, keeping exactly one record', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-avatars-replace-'))
    const library = createLibrary(root)

    await setAvatar(library, 'u1', await png(200, 200))
    await setAvatar(library, 'u1', await png(300, 300))

    expect(await library.for('User', 'u1').getAll('avatar')).toHaveLength(1)
  })

  it('rejects a type the collection does not accept', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-avatars-mime-'))
    const library = createLibrary(root)

    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .gif()
      .toBuffer()

    // The collection lists jpeg/png/webp only.
    await expect(
      library.for('User', 'u1').add(gif).usingFileName('avatar.gif').toCollection('avatar'),
    ).rejects.toThrow()
  })
})
