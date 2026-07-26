import { MediaLibraryConfig, ResolvedConfig, resolveConfig } from './config.js'
import { ModelMediaHandle } from './handle.js'
import { TypedEmitter } from './events.js'
import type { MediaEventMap } from './events.js'
import { CollectionDefinition, DEFAULT_COLLECTION } from './definitions/collection.js'
import { UnknownModelError, MediaLibraryError } from './errors.js'
import type { MediaRecord } from './types.js'
import type { MediaRepository } from './repository.js'
import type { ResolvedStorage } from './storage/resolve.js'
import type { PathGenerator } from './storage/path-generator.js'
import type { UrlGenerator } from './storage/url-generator.js'

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

  constructor(config: MediaLibraryConfig) {
    this.resolved = resolveConfig(config)
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
    return new ModelMediaHandle(modelType, String(modelId))
  }

  getCollectionDefinition(modelType: string, collection: string): CollectionDefinition {
    return this.resolved.models[modelType]?.[collection] ?? DEFAULT_COLLECTION
  }

  async deleteMedia(_mediaOrId: MediaRecord | string): Promise<void> {
    throw new MediaLibraryError('not implemented')
  }

  async clearFor(_modelType: string, _modelId: string | number, _collection?: string): Promise<void> {
    throw new MediaLibraryError('not implemented')
  }
}
