import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createLibrary, addImage, reorderGallery, renderData } from '../src/galleries.js'

/** Big enough that the width calculator produces several variants. */
const png = (width = 1600, height = 1200) =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .png()
    .toBuffer()

async function library() {
  return createLibrary(await mkdtemp(join(tmpdir(), 'nml-gallery-')))
}

describe('Galleries & responsive images', () => {
  it('builds a srcset with descending widths for the original', async () => {
    const lib = await library()
    const media = await addImage(lib, 'p1', await png(), 'Front view')

    const { srcset } = await renderData(lib, media.id)

    expect(srcset).not.toBeNull()
    const widths = [...srcset!.matchAll(/ (\d+)w/g)].map((m) => Number(m[1]))
    expect(widths.length).toBeGreaterThan(1)
    expect(widths[0]).toBe(1600) // widest first, matching the source
    expect(widths).toEqual([...widths].sort((a, b) => b - a))
  })

  it('generates an LQIP placeholder as an inline data URI', async () => {
    const lib = await library()
    const media = await addImage(lib, 'p1', await png(), 'Front view')

    const { placeholder } = await renderData(lib, media.id)

    expect(placeholder).toMatch(/^data:image\/svg\+xml;base64,/)
  })

  it('gives a conversion its own variant set when it opts in', async () => {
    const lib = await library()
    const media = await addImage(lib, 'p1', await png(), 'Front view')

    const { heroSrcset } = await renderData(lib, media.id)

    // `hero` calls .withResponsiveImages(); `card` does not.
    expect(heroSrcset).not.toBeNull()
    expect(await lib.srcset(media.id, 'card')).toBeNull()
  })

  it('returns widest-first URLs matching the srcset entries', async () => {
    const lib = await library()
    const media = await addImage(lib, 'p1', await png(), 'Front view')

    const { urls, srcset } = await renderData(lib, media.id)

    expect(urls.length).toBeGreaterThan(1)
    expect(srcset).toContain(urls[0]!)
  })

  it('reorders to the requested sequence', async () => {
    const lib = await library()
    const a = await addImage(lib, 'p1', await png(400, 300), 'A')
    const b = await addImage(lib, 'p1', await png(400, 300), 'B')
    const c = await addImage(lib, 'p1', await png(400, 300), 'C')

    const ordered = await reorderGallery(lib, 'p1', [c.id, a.id, b.id])

    expect(ordered.map((m) => m.name)).toEqual(['C', 'A', 'B'])
  })

  it('ignores ids belonging to another product', async () => {
    const lib = await library()
    const mine = await addImage(lib, 'p1', await png(400, 300), 'Mine')
    const theirs = await addImage(lib, 'p2', await png(400, 300), 'Theirs')

    await reorderGallery(lib, 'p1', [theirs.id, mine.id])

    // p2's media is untouched — a tampered payload cannot renumber it.
    const other = await lib.for('Product', 'p2').getAll('gallery')
    expect(other.map((m) => m.id)).toEqual([theirs.id])
  })
})
