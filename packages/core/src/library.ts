import { DEFAULT_SIGNED_URL_EXPIRES_IN, MediaLibraryConfig, ResolvedConfig, resolveConfig } from './config.js'
import { ModelMediaHandle } from './handle.js'
import { TypedEmitter } from './events.js'
import type { MediaEventMap } from './events.js'
import { CollectionDefinition, DEFAULT_COLLECTION } from './definitions/collection.js'
import { UnknownModelError, MediaLibraryError } from './errors.js'
import type { JsonObject, MediaRecord } from './types.js'
import type { ResponsiveImagesEntry } from './responsive/types.js'
import type { MediaRepository } from './repository.js'
import type { ResolvedStorage } from './storage/resolve.js'
import type { PathGenerator } from './storage/path-generator.js'
import type { UrlGenerator } from './storage/url-generator.js'
import { DefaultUrlGenerator } from './storage/url-generator.js'
import { ConversionEngine, RegenerateOptions } from './conversions/engine.js'
import { conversionFileName } from './conversions/naming.js'
import type { QueueDriver } from './queue.js'
import { Readable } from 'node:stream'
import { contentDisposition } from './downloads/response.js'

export function createMediaLibrary(config: MediaLibraryConfig): MediaLibrary {
  return new MediaLibrary(config)
}

/** Limits/fields FileAdder and ModelMediaHandle need to validate incoming files (Task 11+). */
export interface ResolvedLimits {
  readonly maxFileSize: number
  readonly disallowedExtensions: readonly string[]
  readonly allowedExtensions: readonly string[] | null
  readonly fileNameSanitizer: ResolvedConfig['fileNameSanitizer']
}

export class MediaLibrary {
  readonly events = new TypedEmitter<MediaEventMap>()
  private readonly resolved: ResolvedConfig
  private readonly engine: ConversionEngine
  private readonly urlGeneratorInstance: UrlGenerator

  constructor(config: MediaLibraryConfig) {
    this.resolved = resolveConfig(config)
    this.engine = new ConversionEngine({
      repository: this.resolved.repository,
      storage: this.resolved.storage,
      pathGenerator: this.resolved.pathGenerator,
      events: this.events,
      generators: [...this.resolved.imageGenerators],
      definitionsFor: (modelType, collection) =>
        this.getCollectionDefinition(modelType, collection).conversions,
      collectionFor: (modelType, collection) => this.getCollectionDefinition(modelType, collection),
      widthCalculator: this.resolved.responsiveWidthCalculator,
      responsivePlaceholders: this.resolved.responsivePlaceholders,
    })
    this.resolved.queue.registerProcessor((job) => this.engine.perform(job.mediaId, job.conversionNames))

    // Built here (after `this.engine` exists) rather than reused from
    // `resolveConfig()`'s own default, since the `conversionFileNameFor` dep
    // needs `engine.applicable()` — a circular dependency resolveConfig()
    // alone can't express. A user-supplied `config.urlGenerator` always wins
    // and is used as-is (it may have its own, unrelated conversion logic).
    this.urlGeneratorInstance =
      config.urlGenerator ??
      new DefaultUrlGenerator(this.resolved.storage, this.resolved.pathGenerator, {
        versionUrls: config.versionUrls ?? false,
        signedUrlExpiresIn: config.signedUrlExpiresIn ?? DEFAULT_SIGNED_URL_EXPIRES_IN,
        conversionFileNameFor: (media, name) => {
          const def = this.engine.applicable(media)[name]
          return def ? conversionFileName(media.fileName, name, this.engine.effectiveFormat(media, def)) : null
        },
      })
  }

  /** @internal Consumed by FileAdder (nonQueued conversions) and tests. */
  get queue(): QueueDriver {
    return this.resolved.queue
  }

  /** @internal Consumed by FileAdder to split dispatch into nonQueued/queued names. */
  get conversionEngine(): ConversionEngine {
    return this.engine
  }

  /** Runs `names` (or all applicable) conversions for `mediaId` inline. */
  async performConversions(mediaId: string, names?: string[]): Promise<void> {
    return this.engine.perform(mediaId, names)
  }

  /**
   * Updates `mediaId`'s per-conversion manipulation overrides and dispatches
   * regeneration for the changed conversions through the queue — per spec
   * §8, "changing it triggers regeneration". Always goes through the queue
   * (not inline) regardless of the conversion's own `queued` flag, since
   * this is an explicit, user-triggered update rather than upload dispatch.
   *
   * `manipulations` REPLACES the record's full manipulations map — it is
   * not merged with the existing one. Callers who want to keep prior
   * overrides for other conversions must include them in this call.
   */
  async updateManipulations(
    mediaId: string,
    manipulations: Record<string, JsonObject>,
  ): Promise<MediaRecord> {
    const updated = await this.resolved.repository.update(mediaId, { manipulations })
    await this.resolved.queue.enqueue({ mediaId, conversionNames: Object.keys(manipulations) })
    return updated
  }

  /**
   * Re-enqueues conversion generation across a set of media records.
   * `opts.ids` (when given) selects exactly those records via `findById`,
   * silently skipping any that don't exist; otherwise every record —
   * optionally narrowed to `opts.modelType` — is visited via
   * `repository.iterateAll()`. For each record, the applicable conversion
   * names are further narrowed by `opts.only` (intersection) and, when
   * `opts.onlyMissing` is set, by excluding names already marked `true` in
   * `generatedConversions`. Records left with zero names to regenerate are
   * skipped entirely — nothing is enqueued for them. Returns the number of
   * `queue.enqueue()` calls made (one per record with names left to run),
   * not the number of individual conversions.
   *
   * With the sync queue driver, a record whose enqueued conversions all
   * fail rethrows synchronously from `enqueue()`, which aborts this run
   * mid-iteration — records not yet visited are never dispatched, and the
   * returned `enqueued` count reflects only what was queued before the
   * failure.
   */
  async regenerate(opts: RegenerateOptions = {}): Promise<{ enqueued: number }> {
    let enqueued = 0

    const dispatch = async (record: MediaRecord): Promise<void> => {
      let names = Object.keys(this.engine.applicable(record))
      if (opts.only) {
        const only = new Set(opts.only)
        names = names.filter((name) => only.has(name))
      }
      if (opts.onlyMissing) {
        names = names.filter((name) => record.generatedConversions[name] !== true)
      }

      if (opts.withResponsive && this.engine.wantsOriginalResponsive(record)) {
        const missing = record.responsiveImages['original'] === undefined
        if (!opts.onlyMissing || missing) names.push('original')
      }

      if (names.length === 0) return

      await this.resolved.queue.enqueue({ mediaId: record.id, conversionNames: names })
      enqueued += 1
    }

    if (opts.ids) {
      const records = (
        await Promise.all(opts.ids.map((id) => this.resolved.repository.findById(id)))
      ).filter((record): record is MediaRecord => record !== null)
      for (const record of records) {
        await dispatch(record)
      }
    } else {
      for await (const record of this.resolved.repository.iterateAll({ modelType: opts.modelType })) {
        await dispatch(record)
      }
    }

    return { enqueued }
  }

  /** @internal Consumed by FileAdder/ModelMediaHandle (Task 11+). */
  get repository(): MediaRepository {
    return this.resolved.repository
  }

  /** @internal Consumed by FileAdder/ModelMediaHandle (Task 11+). */
  get storage(): ResolvedStorage {
    return this.resolved.storage
  }

  /** @internal Consumed by FileAdder/ModelMediaHandle (Task 11+). */
  get pathGenerator(): PathGenerator {
    return this.resolved.pathGenerator
  }

  /** @internal Consumed by FileAdder/ModelMediaHandle (Task 11+). */
  get urlGenerator(): UrlGenerator {
    return this.urlGeneratorInstance
  }

  /** @internal Consumed by FileAdder/ModelMediaHandle (Task 11+). */
  get limits(): ResolvedLimits {
    return {
      maxFileSize: this.resolved.maxFileSize,
      disallowedExtensions: this.resolved.disallowedExtensions,
      allowedExtensions: this.resolved.allowedExtensions,
      fileNameSanitizer: this.resolved.fileNameSanitizer,
    }
  }

  for(modelType: string, modelId: string | number): ModelMediaHandle {
    if (!(modelType in this.resolved.models)) {
      throw new UnknownModelError(`Model type "${modelType}" is not registered`)
    }
    return new ModelMediaHandle(modelType, String(modelId), this)
  }

  /** Registered model type names (e.g. `['User', 'Post']`). */
  get modelTypes(): string[] {
    return Object.keys(this.resolved.models)
  }

  getCollectionDefinition(modelType: string, collection: string): CollectionDefinition {
    return this.resolved.models[modelType]?.[collection] ?? DEFAULT_COLLECTION
  }

  /** Resolves `mediaOrId` to a `MediaRecord`, throwing `MediaLibraryError` when a string id doesn't exist. */
  private async requireMedia(mediaOrId: MediaRecord | string): Promise<MediaRecord> {
    const media =
      typeof mediaOrId === 'string' ? await this.resolved.repository.findById(mediaOrId) : mediaOrId
    if (!media) throw new MediaLibraryError('media not found')
    return media
  }

  private responsiveEntry(media: MediaRecord, conversion: string): ResponsiveImagesEntry | null {
    const entry = media.responsiveImages[conversion]
    if (!entry || typeof entry !== 'object') return null
    return entry as unknown as ResponsiveImagesEntry
  }

  /**
   * Public (or, with `opts.signed`, signed) URLs for `conversion`'s stored
   * responsive variants (widest first, mirroring stored order). `[]` when
   * there's no entry, or when the configured `UrlGenerator` doesn't
   * implement the relevant optional member (`responsiveUrl` /
   * `responsiveSignedUrl`) — graceful degradation for custom generators
   * predating responsive images or signed responsive URLs.
   */
  async responsiveUrls(
    mediaOrId: MediaRecord | string,
    conversion = 'original',
    opts?: { signed?: boolean; expiresIn?: string | number },
  ): Promise<string[]> {
    const media = await this.requireMedia(mediaOrId)
    const entry = this.responsiveEntry(media, conversion)
    if (!entry?.files?.length) return []

    if (opts?.signed) {
      if (!this.urlGeneratorInstance.responsiveSignedUrl) return []
      return Promise.all(
        entry.files.map((f) =>
          this.urlGeneratorInstance.responsiveSignedUrl!(media, f.fileName, { expiresIn: opts.expiresIn }),
        ),
      )
    }

    if (!this.urlGeneratorInstance.responsiveUrl) return []
    return Promise.all(entry.files.map((f) => this.urlGeneratorInstance.responsiveUrl!(media, f.fileName)))
  }

  /** `'url1 800w, url2 669w'` srcset string; `null` when there's no entry/empty files. */
  async srcset(
    mediaOrId: MediaRecord | string,
    conversion = 'original',
    opts?: { signed?: boolean; expiresIn?: string | number },
  ): Promise<string | null> {
    const media = await this.requireMedia(mediaOrId)
    const entry = this.responsiveEntry(media, conversion)
    if (!entry?.files?.length) return null

    if (opts?.signed) {
      if (!this.urlGeneratorInstance.responsiveSignedUrl) return null
      const parts = await Promise.all(
        entry.files.map(
          async (f) =>
            `${await this.urlGeneratorInstance.responsiveSignedUrl!(media, f.fileName, { expiresIn: opts.expiresIn })} ${f.width}w`,
        ),
      )
      return parts.join(', ')
    }

    if (!this.urlGeneratorInstance.responsiveUrl) return null
    const parts = await Promise.all(
      entry.files.map(async (f) => `${await this.urlGeneratorInstance.responsiveUrl!(media, f.fileName)} ${f.width}w`),
    )
    return parts.join(', ')
  }

  /** The LQIP base64 SVG data URI for `conversion`, or `null` when absent. */
  async placeholder(mediaOrId: MediaRecord | string, conversion = 'original'): Promise<string | null> {
    const media = await this.requireMedia(mediaOrId)
    return this.responsiveEntry(media, conversion)?.placeholder ?? null
  }

  async deleteMedia(mediaOrId: MediaRecord | string): Promise<void> {
    const media = await this.requireMedia(mediaOrId)

    this.events.emit('media:deleting', { media })
    const disk = await this.resolved.storage.disk(media.disk)
    await disk.deleteAll(this.resolved.pathGenerator.directory(media))
    if (media.conversionsDisk && media.conversionsDisk !== media.disk) {
      const conversionsDisk = await this.resolved.storage.disk(media.conversionsDisk)
      await conversionsDisk.deleteAll(this.resolved.pathGenerator.conversionsPath(media))
    }
    await this.resolved.repository.delete(media.id)
    this.events.emit('media:deleted', { media })
  }

  /**
   * Deletes every record in `collection` (or all collections, when omitted
   * or `'*'`) for the given model and emits `collection:cleared`. This is
   * the shared implementation behind both `MediaLibrary.clearFor()` and
   * `ModelMediaHandle.clear()` — keeping one code path prevents the two
   * from drifting out of sync on the emitted event.
   *
   * `'*'` is the documented "all collections" sentinel (mirroring
   * `ModelMediaHandle.getAll()`), so it must be normalized to `undefined`
   * before reaching `findForModel` — otherwise it's matched literally
   * against `collectionName` and matches nothing.
   */
  async clearFor(modelType: string, modelId: string | number, collection?: string): Promise<void> {
    const id = String(modelId)
    const scoped = collection === undefined || collection === '*' ? undefined : collection
    const records = await this.resolved.repository.findForModel(modelType, id, scoped)
    for (const record of records) {
      await this.deleteMedia(record)
    }
    this.events.emit('collection:cleared', {
      modelType,
      modelId: id,
      collection: collection ?? '*',
    })
  }

  /**
   * Web-standard Response streaming the file from storage — works natively in
   * Hono/Next/Bun/Deno; use toNodeStream() for Express-style servers. A
   * generated conversion streams its derived file; an unknown/ungenerated
   * conversionName gracefully falls back to the original (mirrors url()).
   */
  async download(mediaOrId: MediaRecord | string, conversionName?: string): Promise<Response> {
    return this.fileResponse('attachment', mediaOrId, conversionName)
  }

  async inline(mediaOrId: MediaRecord | string, conversionName?: string): Promise<Response> {
    return this.fileResponse('inline', mediaOrId, conversionName)
  }

  private async fileResponse(
    kind: 'attachment' | 'inline',
    mediaOrId: MediaRecord | string,
    conversionName?: string,
  ): Promise<Response> {
    const media = await this.requireMedia(mediaOrId)

    let path = this.resolved.pathGenerator.path(media)
    let diskName = media.disk
    let fileName = media.fileName
    let contentType = media.mimeType
    let contentLength: string | null = String(media.size)

    if (conversionName && media.generatedConversions[conversionName] === true) {
      const def = this.engine.applicable(media)[conversionName]
      if (def) {
        const format = this.engine.effectiveFormat(media, def)
        fileName = conversionFileName(media.fileName, conversionName, format)
        path = `${this.resolved.pathGenerator.conversionsPath(media)}/${fileName}`
        diskName = media.conversionsDisk ?? media.disk
        contentType = format ? `image/${format}` : media.mimeType
        contentLength = null // size of derived files isn't tracked on the record
      }
    }

    const disk = await this.resolved.storage.disk(diskName)
    const stream = await disk.getStream(path)

    const headers = new Headers()
    if (contentType) headers.set('Content-Type', contentType)
    if (contentLength) headers.set('Content-Length', contentLength)
    headers.set('Content-Disposition', contentDisposition(kind, fileName))

    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers })
  }
}
