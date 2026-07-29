import { describe, it, expect, beforeAll } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { conversion } from '@node-media-library/core'
import { videoImageGenerator } from '../src/generator.js'
import { ffmpegAvailable } from '../src/run.js'

const execFileAsync = promisify(execFile)
const available = await ffmpegAvailable()

describe('videoImageGenerator (no binary needed)', () => {
  it('supports any video/* mime and nothing else', () => {
    const gen = videoImageGenerator()
    expect(gen.supports('video/mp4')).toBe(true)
    expect(gen.supports('video/webm')).toBe(true)
    expect(gen.supports('application/pdf')).toBe(false)
    expect(gen.supports(null)).toBe(false)
  })
})

describe.runIf(available)('videoImageGenerator (ffmpeg required)', () => {
  let fixture: Buffer
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nml-video-fixture-'))
    const out = join(dir, 'fixture.mp4')
    // 1s 64x48 synthetic clip; -pix_fmt yuv420p for broad decoder compat
    await execFileAsync('ffmpeg', [
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=64x48:rate=10',
      '-pix_fmt',
      'yuv420p',
      '-y',
      out,
    ])
    fixture = await readFile(out)
    return async () => rm(dir, { recursive: true, force: true })
  })

  it('toSourceImage extracts a 64x48 png frame', async () => {
    const png = await videoImageGenerator().toSourceImage!(fixture)
    const meta = await sharp(png).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(64)
    expect(meta.height).toBe(48)
  })

  it('toImage applies the conversion to the extracted frame', async () => {
    const def = conversion().width(32).format('jpeg').videoFrameAtSecond(0.5).toDefinition()
    const out = await videoImageGenerator().toImage(fixture, def)
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(32)
  })
})

describe.runIf(!available)('ffmpeg missing on this machine', () => {
  it('skips the binary-backed tests (install ffmpeg to run them)', () => {
    expect(available).toBe(false)
  })
})
