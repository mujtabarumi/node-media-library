import { FileAdder } from './pipeline/file-adder.js'
import type { MediaSource } from './pipeline/source.js'
import type { MediaLibrary } from './library.js'
import type { JsonObject, MediaRecord } from './types.js'
import type { SignedUrlOptions } from './storage/url-generator.js'
import type { CollectionDefinition } from './definitions/collection.js'

export type MediaQueryFilter = JsonObject | ((media: MediaRecord) => boolean)

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => deepEqual(item, b[i]))
  }
  const aKeys = Object.keys(a as JsonObject)
  const bKeys = Object.keys(b as JsonObject)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(b, key) &&
    deepEqual((a as JsonObject)[key], (b as JsonObject)[key]),
  )
}

function matchesFilter(media: MediaRecord, filter?: MediaQueryFilter): boolean {
  if (filter === undefined) return true
  if (typeof filter === 'function') return filter(media)
  return Object.entries(filter).every(([key, value]) => deepEqual(media.customProperties[key], value))
}

/**
 * Handle bound to a single (modelType, modelId) pair, scoped to operate on
 * that model's media.
 */
export class ModelMediaHandle {
  constructor(
    public readonly modelType: string,
    public readonly modelId: string,
    private readonly library: MediaLibrary,
  ) {}

  /** Returns a `FileAdder` builder; call `.toCollection()` to run the pipeline. */
  add(source: MediaSource): FileAdder {
    return new FileAdder(this.library, this.modelType, this.modelId, source)
  }

  /**
   * Returns media across the model's collections. `collection` undefined or
   * `'*'` means "all collections"; otherwise only that collection's media is
   * returned. `filter` further narrows the result: an object requires every
   * key to deep-equal `customProperties[key]`, a function is a predicate.
   */
  async getAll(collection?: string, filter?: MediaQueryFilter): Promise<MediaRecord[]> {
    const scoped = collection === undefined || collection === '*' ? undefined : collection
    const records = await this.library.repository.findForModel(this.modelType, this.modelId, scoped)
    return records.filter((media) => matchesFilter(media, filter))
  }

  async first(collection?: string): Promise<MediaRecord | null> {
    const records = await this.getAll(collection)
    return records[0] ?? null
  }

  /**
   * `collection().fallbackUrl(url, conversionName)` registers under
   * `conversionName ?? ''` — `''` is the collection's DEFAULT fallback.
   * When a specific conversion name has no fallback of its own registered,
   * Spatie falls back to that default rather than returning nothing, so a
   * collection that only calls `.fallbackUrl(url)` (no conversion name)
   * still backs every conversion-scoped `firstUrl()`/`firstSignedUrl()`
   * call, not just the no-conversion one.
   */
  private fallbackUrlFor(definition: CollectionDefinition, conversionName?: string): string | null {
    if (conversionName === undefined) return definition.fallbackUrls[''] ?? null
    return definition.fallbackUrls[conversionName] ?? definition.fallbackUrls[''] ?? null
  }

  /**
   * Returns the URL of the first media item in `collection`, or the
   * collection's registered fallback URL (if any) when it's empty, or
   * `null` when there's no media and no fallback configured.
   */
  async firstUrl(collection?: string, conversionName?: string): Promise<string | null> {
    const first = await this.first(collection)
    if (!first) {
      const definition = this.library.getCollectionDefinition(this.modelType, collection ?? 'default')
      return this.fallbackUrlFor(definition, conversionName)
    }
    return this.library.urlGenerator.url(first, conversionName)
  }

  async firstSignedUrl(
    collection?: string,
    conversionName?: string,
    opts?: SignedUrlOptions,
  ): Promise<string | null> {
    const first = await this.first(collection)
    if (!first) {
      const definition = this.library.getCollectionDefinition(this.modelType, collection ?? 'default')
      return this.fallbackUrlFor(definition, conversionName)
    }
    return this.library.urlGenerator.signedUrl(first, conversionName, opts)
  }

  /**
   * Returns the URL for the first name in `conversionNames` whose conversion
   * has actually been generated for the collection's first media item, or
   * the original file's URL if none have. All conversions currently report
   * `false` until Plan 3 wires up real generation.
   */
  async availableUrl(collection: string, conversionNames: string[]): Promise<string | null> {
    const first = await this.first(collection)
    if (!first) return null
    for (const name of conversionNames) {
      if (first.generatedConversions[name] === true) {
        return this.library.urlGenerator.url(first, name)
      }
    }
    return this.library.urlGenerator.url(first)
  }

  /**
   * Reorders this handle's media. `ids` is filtered down to records that
   * actually belong to (modelType, modelId) — preserving the caller's
   * relative order — so a foreign media id slipped into the list can't
   * renumber another model's media.
   */
  async reorder(ids: string[]): Promise<void> {
    const owned = await this.library.repository.findForModel(this.modelType, this.modelId)
    const ownedIds = new Set(owned.map((record) => record.id))
    const scopedIds = ids.filter((id) => ownedIds.has(id))
    await this.library.repository.setOrder(scopedIds)
  }

  /** Deletes every record in `collection` (or all collections) and emits `collection:cleared`. */
  async clear(collection?: string): Promise<void> {
    await this.library.clearFor(this.modelType, this.modelId, collection)
  }

  async delete(mediaId: string): Promise<void> {
    await this.library.deleteMedia(mediaId)
  }
}
