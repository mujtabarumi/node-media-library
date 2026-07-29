import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { renderVariant, tinyPlaceholder } from '../src/responsive/generator.js'

async function fixture(width = 1200, height = 900): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } },
  })
    .jpeg()
    .toBuffer()
}

describe('renderVariant', () => {
  it('resizes to the requested width preserving aspect ratio', async () => {
    const out = await renderVariant(await fixture(), 600, null, null)
    expect(out.width).toBe(600)
    expect(out.height).toBe(450)
    const meta = await sharp(out.buffer).metadata()
    expect(meta.width).toBe(600)
    expect(meta.format).toBe('jpeg')
  })

  it('converts to the requested format', async () => {
    const out = await renderVariant(await fixture(), 300, 'webp', 60)
    expect((await sharp(out.buffer).metadata()).format).toBe('webp')
  })
})

describe('tinyPlaceholder', () => {
  it('returns a base64 SVG data URI embedding a blurred jpeg', async () => {
    const uri = await tinyPlaceholder(await fixture())
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const svg = Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString(
      'utf8',
    )
    expect(svg).toContain('<svg')
    expect(svg).toContain('data:image/jpeg;base64,')
    expect(svg).toContain('viewBox="0 0 1200 900"')
  })

  it('swaps width/height in the viewBox for an EXIF-rotated (orientation 6) source', async () => {
    // sharp's metadata() reports PRE-rotation (raw pixel-storage) dimensions
    // even with .rotate() applied; a 300x200 source stored with orientation
    // 6 (90deg CW) has a post-rotation intrinsic size of 200x300.
    const rotated = await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 200, b: 40 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()

    const uri = await tinyPlaceholder(rotated)
    const svg = Buffer.from(uri.slice('data:image/svg+xml;base64,'.length), 'base64').toString(
      'utf8',
    )
    expect(svg).toContain('viewBox="0 0 200 300"')
  })
})
