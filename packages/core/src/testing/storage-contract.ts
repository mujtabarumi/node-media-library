import { describe, it, expect, afterAll } from 'vitest'
import { createMediaLibrary } from '../library.js'
import { InMemoryMediaRepository } from '../repository/in-memory.js'
import { collection } from '../definitions/collection.js'
import { conversion } from '../definitions/conversion.js'
import { conversionFileName } from '../conversions/naming.js'
import type { ResponsiveImagesEntry } from '../responsive/types.js'
import type { DiskConfig } from '../storage/resolve.js'

/**
 * One full lifecycle against a real storage backend: add -> convert ->
 * responsive variants -> `url()` -> `signedUrl()` -> `clean()` -> delete.
 * Shared so MinIO and Cloudflare R2 are held to identical behavior rather
 * than drifting into two hand-written suites.
 *
 * Every write path core has goes through a different `disk.put` call with its
 * own key layout — the original (`pipeline/file-adder.ts`), the conversion and
 * the responsive variants (two separate calls in `conversions/engine.ts`) —
 * so each is asserted at its real key. A write that lands on the wrong key
 * would otherwise pass: `generatedConversions.thumb` flips true for any
 * resolved `put`, whatever key it used.
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
          collections: {
            // `.format('png')` pins the derived file names so the expected
            // keys below are computed the same way regardless of which
            // generator resolves the source; `.withResponsiveImages()` makes
            // one `performConversions()` exercise both derived write paths.
            files: collection().conversions({
              thumb: conversion().width(32).format('png').withResponsiveImages(),
            }),
          },
        },
      },
    })

    const png = async () => {
      const sharp = (await import('sharp')).default
      return sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } })
        .png()
        .toBuffer()
    }

    const originalKey = (id: string, fileName: string) => `${prefix}/${id}/${fileName}`
    const conversionsDir = (id: string) => `${prefix}/${id}/conversions`
    const responsiveDir = (id: string) => `${prefix}/${id}/responsive`

    afterAll(async () => {
      // Best-effort: a failed assertion must not leave the bucket dirty, but a
      // cleanup failure must not mask the real error either. It still gets
      // reported — against a paid bucket a silent swallow leaks objects on
      // every CI run with no signal that it is happening.
      for await (const media of repo.iterateAll()) {
        await library.deleteMedia(media.id).catch((err: unknown) => {
          console.warn(
            `[storage cycle contract: ${name}] failed to clean up media "${media.id}" — the ` +
              `objects under "${prefix}/${media.id}/" may still be in the bucket:`,
            err,
          )
        })
      }
    })

    it('writes an original and reads it back byte-identically', async () => {
      const source = await png()
      const media = await library.for('post', '1').add(source).toCollection('files')
      const disk = await library.storage.disk(media.disk)
      const stored = await disk.getBytes(originalKey(media.id, media.fileName))
      expect(Buffer.from(stored)).toEqual(source)
    })

    it('generates a conversion at its real key and records it', async () => {
      const media = await library
        .for('post', '2')
        .add(await png())
        .toCollection('files')
      await library.performConversions(media.id)

      const fresh = await repo.findById(media.id)
      expect(fresh?.generatedConversions.thumb).toBe(true)

      // The flag alone cannot detect a write to the WRONG key — assert the
      // conversion file is where core will later look for it.
      const disk = await library.storage.disk(media.conversionsDisk ?? media.disk)
      const key = `${conversionsDir(media.id)}/${conversionFileName(media.fileName, 'thumb', 'png')}`
      expect(await disk.exists(key)).toBe(true)
    })

    it('writes responsive variants at their real keys', async () => {
      const media = await library
        .for('post', '3')
        .add(await png())
        .toCollection('files')
      await library.performConversions(media.id)

      const fresh = await repo.findById(media.id)
      const entry = fresh?.responsiveImages.thumb as ResponsiveImagesEntry | undefined
      expect(entry?.files?.length).toBeGreaterThan(0)

      // Responsive variants are a separate `disk.put` with its own key layout
      // and its own write options — a passing conversion says nothing about
      // this path.
      const disk = await library.storage.disk(media.disk)
      for (const file of entry!.files) {
        expect(await disk.exists(`${responsiveDir(media.id)}/${file.fileName}`)).toBe(true)
      }
    })

    it('produces a signed URL that fetches the object', async () => {
      const media = await library
        .for('post', '4')
        .add(await png())
        .toCollection('files')
      const res = await fetch(await library.urlGenerator.signedUrl(media))
      expect(res.status).toBe(200)
      expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0)
    })

    it('clean() lists derived files and removes an orphan', async () => {
      const media = await library
        .for('post', '5')
        .add(await png())
        .toCollection('files')
      await library.performConversions(media.id)

      const disk = await library.storage.disk(media.conversionsDisk ?? media.disk)
      const dir = conversionsDir(media.id)
      const orphan = `${dir}/orphan-not-a-conversion.png`
      await disk.put(orphan, await png())

      // `clean()` is the only caller of `disk.listAll` in the whole codebase,
      // and `library.ts`'s `listDirectChildren` wraps it in `catch { return [] }`
      // — so a listing that fails or paginates wrongly makes clean() silently
      // delete nothing, forever, with no error. Assert the listing itself
      // before trusting clean()'s result, or that failure passes as success.
      const listed = await disk.listAll(dir, { recursive: true })
      const keys = [...listed.objects].filter((o) => o.isFile).map((o) => o.key)
      expect(keys).toContain(orphan)

      const result = await library.clean()
      expect(result.staleFilesDeleted).toBeGreaterThanOrEqual(1)
      expect(await disk.exists(orphan)).toBe(false)
      // The real conversion survives: clean()'s expected-name computation and
      // the engine's write agree on the key layout.
      const kept = `${dir}/${conversionFileName(media.fileName, 'thumb', 'png')}`
      expect(await disk.exists(kept)).toBe(true)
    })

    it('deletes every object it wrote', async () => {
      const media = await library
        .for('post', '6')
        .add(await png())
        .toCollection('files')
      const disk = await library.storage.disk(media.disk)
      const key = originalKey(media.id, media.fileName)
      expect(await disk.exists(key)).toBe(true)
      await library.deleteMedia(media.id)
      expect(await disk.exists(key)).toBe(false)
    })

    it.runIf(Boolean(opts.publicBaseUrl))('public URLs come from baseUrl', async () => {
      const media = await library
        .for('post', '7')
        .add(await png())
        .toCollection('files')
      const url = await library.urlGenerator.url(media)
      expect(url.startsWith(opts.publicBaseUrl!.replace(/\/+$/, ''))).toBe(true)
    })
  })
}
