import { MediaLibraryConfig, ResolvedConfig, resolveConfig } from './config.js'
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
import { ConversionEngine } from './conversions/engine.js'
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
    })
    this.resolved.queue.registerProcessor((job) => this.engine.perform(job.mediaId, job.conversionNames))
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
   */
  async updateManipulations(
    mediaId: string,
    manipulations: Record<string, JsonObject>,
  ): Promise<MediaRecord> {
    const updated = await this.resolved.repository.update(mediaId, { manipulations })
    await this.resolved.queue.enqueue({ mediaId, conversionNames: Object.keys(manipulations) })
    return updated
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
    return this.resolved.urlGenerator
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
