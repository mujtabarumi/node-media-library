import type { MediaRepository } from './repository.js'
import type { StorageConfig, ResolvedStorage } from './storage/resolve.js'
import { resolveStorage } from './storage/resolve.js'
import type { PathGenerator } from './storage/path-generator.js'
import { DefaultPathGenerator } from './storage/path-generator.js'
import type { UrlGenerator } from './storage/url-generator.js'
import { DefaultUrlGenerator } from './storage/url-generator.js'
import type { CollectionBuilder, CollectionDefinition } from './definitions/collection.js'
import { DEFAULT_DISALLOWED_EXTENSIONS } from './pipeline/validate.js'
import type { FileNameSanitizer } from './pipeline/sanitize.js'
import { sanitizeFileName } from './pipeline/sanitize.js'
import type { QueueDriver } from './queue.js'
import { syncDriver } from './queue.js'
import type { ImageGenerator } from './conversions/image-generator.js'
import { sharpImageGenerator } from './conversions/image-generator.js'
import type { WidthCalculator } from './responsive/width-calculator.js'
import { FileSizeOptimizedWidthCalculator } from './responsive/width-calculator.js'

export interface MediaLibraryConfig {
  repository: MediaRepository
  storage?: StorageConfig
  models: Record<string, { collections?: Record<string, CollectionBuilder> }>
  /** Default 10 * 1024 * 1024 (10 MiB). */
  maxFileSize?: number
  /** Default DEFAULT_DISALLOWED_EXTENSIONS. */
  disallowedExtensions?: string[]
  allowedExtensions?: string[]
  /** Default false. */
  versionUrls?: boolean
  /** Default '30 mins'. */
  signedUrlExpiresIn?: string | number
  fileNameSanitizer?: FileNameSanitizer
  pathGenerator?: PathGenerator
  urlGenerator?: UrlGenerator
  /** Default `syncDriver()` (conversions run inline, synchronously). */
  queue?: QueueDriver
  /** Default `[sharpImageGenerator()]`. */
  imageGenerators?: ImageGenerator[]
  /** Default `new FileSizeOptimizedWidthCalculator()`. */
  responsiveWidthCalculator?: WidthCalculator
  /** Generate LQIP placeholders for responsive variants. Default true. */
  responsivePlaceholders?: boolean
}

/**
 * Fully resolved, frozen configuration produced once at construction time.
 * `models` holds materialized `CollectionDefinition`s (builders are consumed
 * up front) keyed by modelType then collection name. Consumed internally by
 * `MediaLibrary`, and by `FileAdder`/`ModelMediaHandle` in later tasks.
 */
export interface ResolvedConfig {
  readonly repository: MediaRepository
  readonly storage: ResolvedStorage
  readonly pathGenerator: PathGenerator
  readonly urlGenerator: UrlGenerator
  readonly maxFileSize: number
  readonly disallowedExtensions: readonly string[]
  readonly allowedExtensions: readonly string[] | null
  readonly fileNameSanitizer: FileNameSanitizer
  readonly models: Readonly<Record<string, Readonly<Record<string, CollectionDefinition>>>>
  readonly queue: QueueDriver
  readonly imageGenerators: readonly ImageGenerator[]
  readonly responsiveWidthCalculator: WidthCalculator
  readonly responsivePlaceholders: boolean
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024
/** Exported so MediaLibrary can rebuild the default UrlGenerator with the
 * `conversionFileNameFor` dep (which needs the ConversionEngine, built after
 * resolveConfig()) using the same default expiry. */
export const DEFAULT_SIGNED_URL_EXPIRES_IN = '30 mins'

export function resolveConfig(config: MediaLibraryConfig): ResolvedConfig {
  const storage = resolveStorage(config.storage)
  const pathGenerator = config.pathGenerator ?? new DefaultPathGenerator(storage.prefix)
  const urlGenerator =
    config.urlGenerator ??
    new DefaultUrlGenerator(storage, pathGenerator, {
      versionUrls: config.versionUrls ?? false,
      signedUrlExpiresIn: config.signedUrlExpiresIn ?? DEFAULT_SIGNED_URL_EXPIRES_IN,
    })

  const models: Record<string, Readonly<Record<string, CollectionDefinition>>> = {}
  for (const [modelType, modelConfig] of Object.entries(config.models)) {
    const collections: Record<string, CollectionDefinition> = {}
    for (const [name, builder] of Object.entries(modelConfig.collections ?? {})) {
      collections[name] = builder.toDefinition()
    }
    models[modelType] = Object.freeze(collections)
  }

  return Object.freeze({
    repository: config.repository,
    storage,
    pathGenerator,
    urlGenerator,
    maxFileSize: config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
    disallowedExtensions: Object.freeze([
      ...(config.disallowedExtensions ?? DEFAULT_DISALLOWED_EXTENSIONS),
    ]),
    allowedExtensions: config.allowedExtensions ? Object.freeze([...config.allowedExtensions]) : null,
    fileNameSanitizer: config.fileNameSanitizer ?? sanitizeFileName,
    models: Object.freeze(models),
    queue: config.queue ?? syncDriver(),
    imageGenerators: Object.freeze(config.imageGenerators ?? [sharpImageGenerator()]),
    responsiveWidthCalculator: config.responsiveWidthCalculator ?? new FileSizeOptimizedWidthCalculator(),
    responsivePlaceholders: config.responsivePlaceholders ?? true,
  })
}
