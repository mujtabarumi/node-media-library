import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createLibrary, storeAvatar, avatarUrls } from '../src/first-upload.js'

async function pngAt(path: string, width = 200, height = 150): Promise<void> {
  await writeFile(
    path,
    await sharp({ create: { width, height, channels: 3, background: '#336699' } })
      .png()
      .toBuffer(),
  )
}

describe('Your first upload', () => {
  it('stores the file, sniffs its type, and derives the thumb inline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-first-upload-'))
    const library = createLibrary(root)

    const upload = join(root, 'upload.png')
    await pngAt(upload)

    const media = await storeAvatar(library, upload)

    // Sniffed from the bytes, as the page claims — not from the extension.
    expect(media.mimeType).toBe('image/png')
    expect(media.id).toBeTruthy()

    const { original, thumb } = await avatarUrls(library)
    expect(original).toContain('http://localhost:3000/media/')
    expect(original).toContain('/upload.png')

    // .nonQueued() means the conversion exists by the time add() resolves,
    // which is the whole reason the page recommends it for this case.
    expect(thumb).toContain('/conversions/upload-thumb.webp')
  })

  it('moves a path source rather than copying it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-first-upload-move-'))
    const library = createLibrary(root)

    const upload = join(root, 'upload.png')
    await pngAt(upload)
    await access(upload) // present before

    await storeAvatar(library, upload)

    // The page's caution: "after that add(), /tmp/upload.png no longer exists".
    await expect(access(upload)).rejects.toThrow()
  })

  it('replaces the previous avatar instead of accumulating', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-first-upload-single-'))
    const library = createLibrary(root)

    for (const name of ['one.png', 'two.png']) {
      const path = join(root, name)
      await pngAt(path)
      await library.for('User', 'user-1').add(path).toCollection('avatar')
    }

    const all = await library.for('User', 'user-1').getAll('avatar')
    expect(all).toHaveLength(1)
    expect(all[0]!.fileName).toBe('two.png')
  })

  it('rejects a file whose real type is not an image', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-first-upload-mime-'))
    const library = createLibrary(root)

    // A PHP script wearing a .png extension — the case the page calls out.
    const disguised = join(root, 'photo.png')
    await writeFile(disguised, '<?php echo "pwned"; ?>')

    await expect(
      library.for('User', 'user-1').add(disguised).toCollection('avatar'),
    ).rejects.toThrow()
  })
})
