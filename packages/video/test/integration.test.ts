import { describe, it, expect, beforeAll } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  collection,
  conversion,
  createMediaLibrary,
  InMemoryMediaRepository,
  sharpImageGenerator,
} from '@node-media-library/core'
import { videoImageGenerator } from '../src/generator.js'
import { ffmpegAvailable } from '../src/run.js'

const execFileAsync = promisify(execFile)
const available = await ffmpegAvailable()

describe.runIf(available)('video end-to-end through the media pipeline', () => {
  let fixtureDir: string
  let fixture: Buffer

  beforeAll(async () => {
    fixtureDir = await mkdtemp(join(tmpdir(), 'nml-video-int-fixture-'))
    const out = join(fixtureDir, 'fixture.mp4')
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
    return async () => rm(fixtureDir, { recursive: true, force: true })
  })

  it('add(mp4) → poster conversion generated + original responsive variants extracted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-video-int-'))
    try {
      const media = createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: { driver: 'fs', root, baseUrl: 'http://cdn.test' } } },
        imageGenerators: [sharpImageGenerator(), videoImageGenerator()],
        models: {
          Clip: {
            collections: {
              videos: collection()
                .withResponsiveImages()
                .conversions({ poster: conversion().width(48).format('jpeg').nonQueued() }),
            },
          },
        },
      })

      const record = await media
        .for('Clip', 'c1')
        .add(fixture)
        .usingFileName('clip.mp4')
        .toCollection('videos')

      const updated = await media.repository.findById(record.id)
      expect(updated?.mimeType).toBe('video/mp4')
      expect(updated?.generatedConversions['poster']).toBe(true)
      const entry = updated?.responsiveImages['original'] as { files: unknown[] }
      expect(entry.files.length).toBeGreaterThan(0)

      const conversionFiles = await readdir(join(root, record.id, 'conversions'))
      expect(conversionFiles).toContain('clip-poster.jpeg')
      const responsiveFiles = await readdir(join(root, record.id, 'responsive'))
      expect(responsiveFiles.some((f) => /___original_\d+_\d+\./.test(f))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
