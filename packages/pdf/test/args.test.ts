import { describe, it, expect } from 'vitest'
import { buildPdftoppmArgs } from '../src/args.js'

describe('buildPdftoppmArgs', () => {
  it('renders exactly one page as png at the given dpi with -singlefile', () => {
    expect(buildPdftoppmArgs(3, 150, '/tmp/in.pdf', '/tmp/out')).toEqual([
      '-png',
      '-r',
      '150',
      '-f',
      '3',
      '-l',
      '3',
      '-singlefile',
      '/tmp/in.pdf',
      '/tmp/out',
    ])
  })
})
