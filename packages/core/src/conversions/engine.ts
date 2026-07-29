import type { MediaRecord } from '../types.js'
import type { MediaRepository } from '../repository.js'
import type { ResolvedStorage } from '../storage/resolve.js'
import { writeOptionsFor } from '../storage/resolve.js'
import type { PathGenerator } from '../storage/path-generator.js'
import type { TypedEmitter } from '../events.js'
import type { MediaEventMap } from '../events.js'
import type { ConversionDefinition } from '../definitions/conversion.js'
import type { CollectionDefinition } from '../definitions/collection.js'
import type { ImageGenerator } from './image-generator.js'
import { conversionKey } from './naming.js'
import type { WidthCalculator } from '../responsive/width-calculator.js'
import { responsiveFileName } from '../responsive/naming.js'
import { renderVariant, tinyPlaceholder } from '../responsive/generator.js'
import type { ResponsiveVariant, ResponsiveImagesEntry } from '../responsive/types.js'
import type { ImageOptimizer, OptimizeContext } from './optimizer.js'

export interface RegenerateOptions {
  modelType?: string
  ids?: string[]
  only?: string[]
  onlyMissing?: boolean
  /**
   * When true, appends the `'original'` responsive-regeneration sentinel to
   * each record's dispatch names whenever `wantsOriginalResponsive(record)`.
   * Under `onlyMissing`, only when `record.responsiveImages['original']` is
   * absent. `only` (which reasons about conversion names) never gates it.
   */
  withResponsive?: boolean
}

export interface ConversionEngineDeps {
  repository: MediaRepository
  storage: ResolvedStorage
  pathGenerator: PathGenerator
  events: TypedEmitter<MediaEventMap>
  generators: ImageGenerator[]
  definitionsFor(modelType: string, collection: string): Record<string, ConversionDefinition>
  collectionFor(modelType: string, collection: string): CollectionDefinition
  widthCalculator: WidthCalculator
  responsivePlaceholders: boolean
  optimizers: readonly ImageOptimizer[]
}

/**
 * Independent copy of `record` (and its `generatedConversions` map) for
 * event payloads. `perform()`'s loop keeps re-reading and re-merging
 * `generatedConversions` as it goes; without this, a listener that retains
 * an event payload across the whole `perform()` call would see every
 * earlier-emitted payload mutate in place — a `conversion:started` payload
 * for the first conversion would appear, after the fact, to already carry
 * later conversions' marks, because it was the *same* object reused.
 */
function snapshot(record: MediaRecord): MediaRecord {
  return { ...record, generatedConversions: { ...record.generatedConversions } }
}

export class ConversionEngine {
  constructor(private readonly deps: ConversionEngineDeps) {}

  /**
   * Runs `buffer` through the configured optimizers in order, each fed the
   * previous output. A result is accepted only if non-empty AND strictly
   * smaller than what it's replacing; a throwing or unhelpful optimizer is
   * skipped (logged via console.warn) rather than failing the conversion —
   * optimization is a best-effort improvement, never a correctness
   * requirement.
   */
  private async optimizeBytes(buffer: Buffer, ctx: OptimizeContext): Promise<Buffer> {
    let out = buffer
    for (const optimizer of this.deps.optimizers) {
      try {
        const result = await optimizer.optimize(out, ctx)
        if (result && result.length > 0 && result.length < out.length) {
          out = result
        }
      } catch (error) {
        console.warn(
          `[media-library] optimizer "${optimizer.name}" failed for ${ctx.fileName}; using unoptimized bytes`,
          error,
        )
      }
    }
    return out
  }

  /**
   * Definitions for `media`'s own collection, filtered by
   * `performOnCollections` (null = applies to every collection it's
   * requested for; otherwise the media's collectionName must be listed) and
   * with any per-media `manipulations[name]` shallow-merged over the
   * matching definition's fields.
   */
  applicable(media: MediaRecord): Record<string, ConversionDefinition> {
    const defs = this.deps.definitionsFor(media.modelType, media.collectionName)
    const result: Record<string, ConversionDefinition> = {}

    for (const [name, def] of Object.entries(defs)) {
      if (def.performOnCollections !== null && !def.performOnCollections.includes(media.collectionName)) {
        continue
      }
      const overrides = media.manipulations[name]
      result[name] = overrides ? { ...def, ...overrides } : def
    }

    return result
  }

  /** Collection-level withResponsiveImages() OR the per-add requested flag. */
  wantsOriginalResponsive(media: MediaRecord): boolean {
    if (this.deps.collectionFor(media.modelType, media.collectionName).responsiveImages) return true
    return media.responsiveImages['requested'] === true
  }

  /**
   * `def.format`, or the raster default ('png') when `def.format` is `null`
   * ("keep original format") but `media`'s generator has to rasterize the
   * source first (`toSourceImage`) — for a non-image original (PDF, video),
   * "keep original format" cannot mean the source container's extension,
   * since the bytes actually written are always a raster encoding. Shared by
   * the conversion loop (what gets encoded/named on disk) and
   * `library.ts`'s `conversionFileNameFor` (what the URL resolves to), so
   * the two can never drift.
   */
  effectiveFormat(media: MediaRecord, def: ConversionDefinition): ConversionDefinition['format'] {
    if (def.format !== null) return def.format
    const generator = this.deps.generators.find((g) => g.supports(media.mimeType))
    return generator?.toSourceImage ? 'png' : null
  }

  /**
   * Renders responsive variants of `source` under `conversionName`, writes
   * them to `{directory}/responsive/` on the media's own disk, records the
   * entry atomically and emits `responsive:generated`. `format`/`quality`
   * come from the conversion definition (null for the original).
   */
  private async generateResponsive(
    media: MediaRecord,
    conversionName: string,
    source: Buffer,
    format: 'jpeg' | 'png' | 'webp' | 'avif' | null,
    quality: number | null,
  ): Promise<void> {
    const sharp = (await import('sharp')).default
    const meta = await sharp(source).rotate().metadata()
    if (!meta.width || !meta.height) return

    // sharp's metadata() reports PRE-rotation (raw pixel-storage) dimensions
    // even with .rotate() applied — EXIF orientations 5-8 swap width/height
    // once actually rendered, so the width calculator must see post-rotation
    // dimensions or it computes ratios against the wrong intrinsic aspect.
    const swapped = meta.orientation !== undefined && meta.orientation >= 5
    const intrinsicWidth = swapped ? meta.height : meta.width
    const intrinsicHeight = swapped ? meta.width : meta.height

    const widths = this.deps.widthCalculator.calculateWidths(source.byteLength, intrinsicWidth, intrinsicHeight)
    const disk = await this.deps.storage.disk(media.disk)
    const dir = this.deps.pathGenerator.responsivePath(media)
    const writeOptions = writeOptionsFor(this.deps.collectionFor(media.modelType, media.collectionName).public)

    // Captured BEFORE the new variants are written, so a regenerate can
    // clean up whichever of the previous entry's files the new variant plan
    // no longer produces (e.g. a narrower widthCalculator on a later run).
    // Read fresh rather than trusting the caller's `media` snapshot, since
    // that may already be stale by the time this runs.
    const current = await this.deps.repository.findById(media.id)
    const previousEntry = current?.responsiveImages[conversionName] as ResponsiveImagesEntry | undefined
    const previousFiles = Array.isArray(previousEntry?.files) ? previousEntry.files : []

    const files: ResponsiveVariant[] = []
    for (const width of widths) {
      const variant = await renderVariant(source, width, format, quality)
      const fileName = responsiveFileName(media.fileName, conversionName, variant.width, variant.height, format)
      const optimized = await this.optimizeBytes(variant.buffer, {
        format,
        fileName,
        media,
        kind: 'responsive',
      })
      await disk.put(`${dir}/${fileName}`, optimized, writeOptions)
      files.push({ fileName, width: variant.width, height: variant.height })
    }

    const entry: ResponsiveImagesEntry = { files }
    if (this.deps.responsivePlaceholders) {
      entry.placeholder = await tinyPlaceholder(source)
    }

    const updated = await this.deps.repository.mergeResponsiveImages(media.id, conversionName, { ...entry })
    this.deps.events.emit('responsive:generated', { media: snapshot(updated), conversion: conversionName })

    // Stale-variant cleanup happens AFTER the new files are written and the
    // merge has landed, so readers never see a gap where neither the old nor
    // the new variant is available. Each delete is independently try/caught
    // — cleanup failing must never fail the generation that already
    // succeeded.
    const newFileNames = new Set(files.map((f) => f.fileName))
    for (const stale of previousFiles) {
      if (newFileNames.has(stale.fileName)) continue
      try {
        await disk.delete(`${dir}/${stale.fileName}`)
      } catch (err) {
        console.warn('[media-library] failed to delete stale responsive variant:', err)
      }
    }
  }

  /**
   * Loads `mediaId` and generates the applicable conversions (optionally
   * narrowed to `names`), plus responsive variants of the original when
   * requested. Missing media, or media with no supporting generator,
   * resolves silently — the job simply outlived its media, or there's
   * nothing this engine can do with it. Per-conversion failures emit
   * `conversion:failed` and don't stop the remaining conversions; the call
   * only rejects if every requested conversion failed.
   *
   * The `'original'` sentinel rides inside `names` (queue job payloads carry
   * no separate field for it — see ConversionEngineDeps) rather than being a
   * real conversion name; it is stripped out before filtering `applicable`
   * and instead triggers `generateResponsive()` for the original file.
   */
  async perform(mediaId: string, names?: string[]): Promise<void> {
    const media = await this.deps.repository.findById(mediaId)
    if (!media) return

    const generator = this.deps.generators.find((g) => g.supports(media.mimeType))
    if (!generator) return

    const applicable = this.applicable(media)
    const originalExplicit = names?.includes('original') ?? false
    const conversionNames = names?.filter((n) => n !== 'original')
    const entries = conversionNames
      ? Object.entries(applicable).filter(([name]) => conversionNames.includes(name))
      : Object.entries(applicable)

    // When `names` is omitted (regenerate-everything path) original
    // responsive regenerates whenever the media opted in; when `names` is
    // given, it only runs if 'original' was explicitly among them.
    const runOriginal = originalExplicit || (names === undefined && this.wantsOriginalResponsive(media))

    if (entries.length === 0 && !runOriginal) return

    const disk = await this.deps.storage.disk(media.disk)
    const original = await disk.getBytes(this.deps.pathGenerator.path(media))
    const originalBuffer = Buffer.from(original)

    const conversionsDisk = await this.deps.storage.disk(media.conversionsDisk ?? media.disk)

    let failures = 0

    // Original responsive variants are generated FIRST, before the
    // conversion loop. Failure policy: if there are no conversion entries
    // to fall back on (this call was only ever going to do this), the
    // failure is the whole story and must propagate; otherwise the
    // conversions below are still worth attempting, so warn and continue.
    if (runOriginal) {
      try {
        // Non-image sources (PDF, video) must be rasterized before sharp
        // sees them; generators that need this declare toSourceImage. The
        // rasterized bytes are always PNG (the seam's fixed raster output),
        // so name/encode the variants as .png rather than inheriting the
        // source's own extension (e.g. .pdf) as generateResponsive's `null`
        // format would otherwise do.
        const responsiveSource = generator.toSourceImage
          ? await generator.toSourceImage(originalBuffer)
          : originalBuffer
        const originalFormat = generator.toSourceImage ? 'png' : null
        await this.generateResponsive(media, 'original', responsiveSource, originalFormat, null)
      } catch (err) {
        // Emitted for both branches below: this is the original-responsive
        // sentinel failing, not a named conversion, so it can never surface
        // as that conversion's 'conversion:failed' — 'responsive:failed' is
        // the only observable signal for it either way.
        this.deps.events.emit('responsive:failed', { media: snapshot(media), conversion: 'original', error: err })
        if (entries.length === 0) {
          throw err
        }
        console.warn('[media-library] responsive generation for the original failed:', err)
      }
    }

    for (const [name, def] of entries) {
      // Snapshot the record at the top of THIS iteration (not the
      // call-local `media` from the top of `perform`): two concurrent
      // `perform()` calls for the same mediaId (e.g. a queued batch and a
      // nonQueued batch, or two parallel callers) would otherwise each
      // patch `generatedConversions` from a stale in-memory copy, and
      // whichever `update()` lands last would silently clobber the other
      // call's marks. This is also what event listeners see for
      // `conversion:started` — a fresh, independent copy per iteration
      // (see the snapshot() helper below), not the object this loop keeps
      // mutating.
      const before = (await this.deps.repository.findById(mediaId)) ?? media
      this.deps.events.emit('conversion:started', { media: snapshot(before), conversion: name })
      // "Keep original format" (format: null) for a source that had to be
      // rasterized (toSourceImage generator) means the raster default
      // (png), not the source container's extension — computed once so the
      // written bytes, the on-disk file name, and the responsive variants
      // below all agree. Ordinary image sources are unaffected (def is
      // returned unchanged).
      const effectiveDef: ConversionDefinition = { ...def, format: this.effectiveFormat(media, def) }
      try {
        const output = await generator.toImage(originalBuffer, effectiveDef)
        const key = conversionKey(media, this.deps.pathGenerator, effectiveDef, name)
        const writeOptions = writeOptionsFor(
          this.deps.collectionFor(media.modelType, media.collectionName).public,
        )
        const optimized = await this.optimizeBytes(output, {
          format: effectiveDef.format,
          fileName: key,
          media,
          kind: 'conversion',
        })
        await conversionsDisk.put(key, optimized, writeOptions)
        if (effectiveDef.responsiveImages) {
          // A failure here lands in this same catch block and counts as
          // this conversion's failure — the conversion file was written,
          // but it isn't marked generated and 'conversion:failed' fires.
          await this.generateResponsive(media, name, output, effectiveDef.format, effectiveDef.quality)
        }
        // The merge is delegated to the repository (Plan 4): no read→write
        // gap in this layer, which serializes it as far as its backend
        // allows — the repository contract narrows, but does not always
        // eliminate, the lost-update window for concurrent perform() calls
        // (see MediaRepository.markConversionGenerated's JSDoc).
        const updated = await this.deps.repository.markConversionGenerated(mediaId, name, true)
        this.deps.events.emit('conversion:completed', { media: snapshot(updated), conversion: name })
      } catch (error) {
        failures += 1
        this.deps.events.emit('conversion:failed', { media: snapshot(before), conversion: name, error })
      }
    }

    if (entries.length > 0 && failures === entries.length) {
      throw new Error(`All ${failures} requested conversion(s) failed for media "${mediaId}"`)
    }
  }
}
