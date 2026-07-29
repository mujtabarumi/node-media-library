import { describe, it, expect } from 'vitest'
import { buildJpegoptimArgs, buildPngquantArgs } from '../src/args.js'

describe('buildJpegoptimArgs', () => {
  it('strip, progressive, quality cap, target file last', () => {
    expect(buildJpegoptimArgs('/t/in.jpg', { max: 80 })).toEqual([
      '--strip-all',
      '--all-progressive',
      '-m80',
      '/t/in.jpg',
    ])
    expect(buildJpegoptimArgs('/t/in.jpg', {})).toEqual([
      '--strip-all',
      '--all-progressive',
      '-m85',
      '/t/in.jpg',
    ])
  })
})

describe('buildPngquantArgs', () => {
  it('force, optional quality, output before input', () => {
    expect(buildPngquantArgs('/t/in.png', '/t/out.png', {})).toEqual([
      '--force',
      '--output',
      '/t/out.png',
      '/t/in.png',
    ])
    expect(buildPngquantArgs('/t/in.png', '/t/out.png', { quality: '65-90' })).toEqual([
      '--force',
      '--quality',
      '65-90',
      '--output',
      '/t/out.png',
      '/t/in.png',
    ])
  })
})
