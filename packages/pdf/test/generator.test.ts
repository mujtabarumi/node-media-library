import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { conversion } from '@node-media-library/core'
import { pdfImageGenerator } from '../src/generator.js'
import { pdftoppmAvailable } from '../src/run.js'
import { makeMinimalPdf } from './fixture.js'

const available = await pdftoppmAvailable()

describe('pdfImageGenerator (no binary needed)', () => {
  it('supports exactly application/pdf', () => {
    const gen = pdfImageGenerator()
    expect(gen.supports('application/pdf')).toBe(true)
    expect(gen.supports('image/jpeg')).toBe(false)
    expect(gen.supports(null)).toBe(false)
  })
})

describe.runIf(available)('pdfImageGenerator (pdftoppm required)', () => {
  it('toSourceImage renders page 1 as a png with the page aspect ratio', async () => {
    const png = await pdfImageGenerator().toSourceImage!(makeMinimalPdf())
    const meta = await sharp(png).metadata()
    expect(meta.format).toBe('png')
    // 200x100pt page → 2:1 aspect (allow rounding)
    expect(Math.abs(meta.width! / meta.height! - 2)).toBeLessThan(0.05)
  })

  it('toImage applies the conversion to the rendered page', async () => {
    const def = conversion().width(120).format('webp').toDefinition()
    const out = await pdfImageGenerator().toImage(makeMinimalPdf(), def)
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(120)
  })
})

describe.runIf(!available)('pdftoppm missing on this machine', () => {
  it('skips the binary-backed tests (install poppler to run them)', () => {
    expect(available).toBe(false)
  })
})
