import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createLibrary, attachImage, reviseAlt, findFeatured, republish } from '../src/metadata.js'

const png = () =>
  sharp({ create: { width: 200, height: 200, channels: 3, background: '#336699' } })
    .png()
    .toBuffer()

async function library() {
  return createLibrary(await mkdtemp(join(tmpdir(), 'nml-metadata-')))
}

describe('Metadata, copy & move', () => {
  it('stores custom properties given at upload time', async () => {
    const lib = await library()
    const media = await attachImage(lib, 'post-1', await png())

    expect(media.customProperties).toMatchObject({
      alt: 'A blue door',
      credit: 'A. Photographer',
      featured: true,
    })
  })

  it('updates one key without disturbing its siblings', async () => {
    const lib = await library()
    const media = await attachImage(lib, 'post-1', await png())

    await reviseAlt(lib, media.id, 'A blue door, 2024')

    const updated = await lib.for('Post', 'post-1').first('images')
    expect(updated!.customProperties['alt']).toBe('A blue door, 2024')
    expect(updated!.customProperties['credit']).toBeUndefined() // removed
    expect(updated!.customProperties['featured']).toBe(true) // sibling preserved
  })

  it('filters by exact property match and by predicate', async () => {
    const lib = await library()
    await attachImage(lib, 'post-1', await png())

    const { featured, large } = await findFeatured(lib, 'post-1')

    expect(featured).toHaveLength(1)
    expect(large).toHaveLength(0) // the fixture is well under 1 MB
  })

  it('copies to another owner with a new id, leaving the source intact', async () => {
    const lib = await library()
    const media = await attachImage(lib, 'post-1', await png())

    const copy = await lib.copyMedia(media.id, 'Post', 'post-2', { toCollection: 'images' })

    expect(copy.id).not.toBe(media.id)
    expect(copy.uuid).not.toBe(media.uuid)
    expect(copy.modelId).toBe('post-2')
    expect(copy.customProperties['alt']).toBe('A blue door')
    // Source untouched
    expect(await lib.for('Post', 'post-1').getAll('images')).toHaveLength(1)
  })

  it('applies the TARGET collection rules, not the source ones', async () => {
    const lib = await library()
    const media = await attachImage(lib, 'post-1', await png())

    // `hero` is singleFile(); copying twice must leave exactly one.
    await lib.copyMedia(media.id, 'Post', 'post-3', { toCollection: 'hero' })
    await lib.copyMedia(media.id, 'Post', 'post-3', { toCollection: 'hero' })

    expect(await lib.for('Post', 'post-3').getAll('hero')).toHaveLength(1)
  })

  it('moves by copying then deleting the source', async () => {
    const lib = await library()
    const media = await attachImage(lib, 'post-1', await png())

    const { moved } = await republish(lib, media.id, 'post-2')

    expect(moved.modelId).toBe('post-2')
    expect(await lib.for('Post', 'post-1').getAll('images')).toHaveLength(0)
  })
})
