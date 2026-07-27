import { describe, it, expect } from 'vitest'
import { FileSizeOptimizedWidthCalculator } from '../src/responsive/width-calculator.js'
import { responsiveFileName } from '../src/responsive/naming.js'

describe('FileSizeOptimizedWidthCalculator', () => {
  const calc = new FileSizeOptimizedWidthCalculator()

  it('starts at the original width and shrinks by ~sqrt(0.7) per step', () => {
    const widths = calc.calculateWidths(1_000_000, 2400, 1800)
    expect(widths[0]).toBe(2400)
    expect(widths.length).toBeGreaterThan(3)
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeLessThan(widths[i - 1]!)
      // each step scales area by 0.7 → width by sqrt(0.7) ≈ 0.8367
      expect(widths[i]! / widths[i - 1]!).toBeGreaterThan(0.8)
      expect(widths[i]! / widths[i - 1]!).toBeLessThan(0.87)
    }
  })

  it('stops when the predicted file size drops below 10KB', () => {
    // tiny source file: predicted size falls under 10KB after the first shrink
    const widths = calc.calculateWidths(12 * 1024, 800, 600)
    expect(widths).toEqual([800])
  })

  it('stops before emitting widths under 20px', () => {
    const widths = calc.calculateWidths(50_000_000, 100, 100)
    expect(widths.every((w) => w >= 20)).toBe(true)
  })

  it('returns integer widths', () => {
    const widths = calc.calculateWidths(1_000_000, 2411, 1017)
    expect(widths.every((w) => Number.isInteger(w))).toBe(true)
  })
})

describe('responsiveFileName', () => {
  it('builds {base}___{conversion}_{w}_{h}{ext}', () => {
    expect(responsiveFileName('photo.jpg', 'thumb', 800, 600, null)).toBe('photo___thumb_800_600.jpg')
  })
  it('honors an output format override', () => {
    expect(responsiveFileName('photo.jpg', 'original', 320, 240, 'webp')).toBe('photo___original_320_240.webp')
  })
  it('handles extensionless names', () => {
    expect(responsiveFileName('file', 'original', 100, 50, null)).toBe('file___original_100_50')
  })
})
