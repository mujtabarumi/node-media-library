import { describe, it, expect } from 'vitest'
import { buildFfmpegFrameArgs } from '../src/args.js'

describe('buildFfmpegFrameArgs', () => {
  it('fast-seeks before input and extracts exactly one png frame', () => {
    expect(buildFfmpegFrameArgs(2.5, '/tmp/in.mp4', '/tmp/out.png')).toEqual([
      '-ss',
      '2.5',
      '-i',
      '/tmp/in.mp4',
      '-frames:v',
      '1',
      '-f',
      'image2',
      '-c:v',
      'png',
      '-y',
      '/tmp/out.png',
    ])
  })
})
