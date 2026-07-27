import { DEFAULT_SIGNED_URL_EXPIRES_IN, MediaLibraryConfig, ResolvedConfig, resolveConfig } from './config.js'
import { ModelMediaHandle } from './handle.js'
import { TypedEmitter } from './events.js'
import type { MediaEventMap } from './events.js'
import { CollectionDefinition, DEFAULT_COLLECTION } from './definitions/collection.js'
import { UnknownModelError, MediaLibraryError } from './errors.js'
import type { JsonObject, MediaRecord } from './types.js'
import type { MediaRepository } from './repository.js'
import type { ResolvedStorage } from './storage/resolve.js'
import type { PathGenerator } from './storage/path-generator.js'
import type { UrlGenerator } from './storage/url-generator.js'
import { DefaultUrlGenerator } from './storage/url-generator.js'
import { ConversionEngine, RegenerateOptions } from './conversions/engine.js'
import { conversionFileName } from './conversions/naming.js'
import type { QueueDriver } from './queue.js'

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
          return def ? conversionFileName(media.fileName, name, def.format) : null
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

  async deleteMedia(mediaOrId: MediaRecord | string): Promise<void> {
    const media =
      typeof mediaOrId === 'string' ? await this.resolved.repository.findById(mediaOrId) : mediaOrId
    if (!media) {
      throw new MediaLibraryError('media not found')
    }

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
}
