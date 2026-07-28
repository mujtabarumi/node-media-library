import { describe, it, expect } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collection, conversion, createMediaLibrary, InMemoryMediaRepository, sharpImageGenerator,
} from '@node-media-library/core'
import { pdfImageGenerator } from '../src/generator.js'
import { pdftoppmAvailable } from '../src/run.js'
import { makeMinimalPdf } from './fixture.js'

const available = await pdftoppmAvailable()

describe.runIf(available)('pdf end-to-end through the media pipeline', () => {
  it('add(pdf) → thumb conversion generated + original responsive variants rasterized', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nml-pdf-int-'))
    try {
      const media = createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: { driver: 'fs', root, baseUrl: 'http://cdn.test' } } },
        imageGenerators: [sharpImageGenerator(), pdfImageGenerator()],
        models: {
          Doc: {
            collections: {
              files: collection()
                .withResponsiveImages()
                .conversions({ thumb: conversion().width(80).format('jpeg').nonQueued() }),
            },
          },
        },
      })

      const record = await media
        .for('Doc', 'd1')
        .add(makeMinimalPdf())
        .usingFileName('doc.pdf')
        .toCollection('files')

      const updated = await media.repository.findById(record.id)
      expect(updated?.mimeType).toBe('application/pdf')
      expect(updated?.generatedConversions['thumb']).toBe(true)
      const entry = updated?.responsiveImages['original'] as { files: unknown[] }
      expect(entry.files.length).toBeGreaterThan(0)

      const conversionFiles = await readdir(join(root, record.id, 'conversions'))
      expect(conversionFiles).toContain('doc-thumb.jpeg')
      const responsiveFiles = await readdir(join(root, record.id, 'responsive'))
      // The naming fix (see fae1db4) guarantees non-image originals (like this
      // PDF) rasterize through toSourceImage and get a `.png` extension on
      // their responsive variants, matching the raster bytes actually written.
      expect(responsiveFiles.some((f) => /___original_\d+_\d+\.png$/.test(f))).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
