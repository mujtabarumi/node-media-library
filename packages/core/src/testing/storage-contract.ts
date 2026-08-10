import { describe, it, expect, afterAll } from 'vitest'
import sharp from 'sharp'
import { createMediaLibrary } from '../library.js'
import { InMemoryMediaRepository } from '../repository/in-memory.js'
import { collection } from '../definitions/collection.js'
import { conversion } from '../definitions/conversion.js'
import type { DiskConfig } from '../storage/resolve.js'

/**
 * One full lifecycle against a real storage backend: add -> convert ->
 * signedUrl -> read back -> delete. Shared so MinIO and Cloudflare R2 are held
 * to identical behavior rather than drifting into two hand-written suites.
 *
 * `opts.publicBaseUrl` opts the run into the public-URL assertion. Omit it for
 * a backend with no public domain attached; the private path (signed URLs) is
 * exercised either way.
 */
export function runStorageCycleContract(
  name: string,
  opts: { disk: DiskConfig; publicBaseUrl?: string },
): void {
  describe(`storage cycle contract: ${name}`, () => {
    // A unique prefix per run so concurrent CI jobs sharing one bucket cannot
    // collide, and so cleanup is scoped to what this run created.
    const prefix = `nml-test/${name.replace(/\W+/g, '-')}/${process.pid}-${Date.now()}`
    const repo = new InMemoryMediaRepository()
    const library = createMediaLibrary({
      repository: repo,
      storage: { prefix, disks: { default: opts.disk }, default: 'default' },
      models: {
        post: {
          collections: { files: collection().conversions({ thumb: conversion().width(32) }) },
        },
      },
    })

    const png = () =>
      sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } })
        .png()
        .toBuffer()

    afterAll(async () => {
      // Best-effort: a failed assertion must not leave the bucket dirty, but a
      // cleanup failure must not mask the real error either.
      for await (const media of repo.iterateAll()) {
        await library.deleteMedia(media.id).catch(() => {})
      }
    })

    it('writes an original and reads it back byte-identically', async () => {
      const source = await png()
      const media = await library.for('post', '1').add(source).toCollection('files')
      const disk = await library.storage.disk(media.disk)
      const stored = await disk.getBytes(`${prefix}/${media.id}/${media.fileName}`)
      expect(Buffer.from(stored)).toEqual(source)
    })

    it('generates a conversion and records it', async () => {
      const media = await library
        .for('post', '2')
        .add(await png())
        .toCollection('files')
      await library.performConversions(media.id)
      const fresh = await repo.findById(media.id)
      expect(fresh?.generatedConversions.thumb).toBe(true)
    })

    it('produces a signed URL that fetches the object', async () => {
      const media = await library
        .for('post', '3')
        .add(await png())
        .toCollection('files')
      const res = await fetch(await library.urlGenerator.signedUrl(media))
      expect(res.status).toBe(200)
      expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0)
    })

    it('deletes every object it wrote', async () => {
      const media = await library
        .for('post', '4')
        .add(await png())
        .toCollection('files')
      const disk = await library.storage.disk(media.disk)
      const key = `${prefix}/${media.id}/${media.fileName}`
      expect(await disk.exists(key)).toBe(true)
      await library.deleteMedia(media.id)
      expect(await disk.exists(key)).toBe(false)
    })

    it.runIf(Boolean(opts.publicBaseUrl))('public URLs come from baseUrl', async () => {
      const media = await library
        .for('post', '5')
        .add(await png())
        .toCollection('files')
      const url = await library.urlGenerator.url(media)
      expect(url.startsWith(opts.publicBaseUrl!.replace(/\/+$/, ''))).toBe(true)
    })
  })
}
