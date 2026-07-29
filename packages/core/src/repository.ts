import { JsonObject, MediaRecord, NewMediaRecord } from './types.js'

export interface MediaFilter {
  modelType?: string
  collectionName?: string
}

export interface MediaRepository {
  create(data: NewMediaRecord): Promise<MediaRecord>
  update(id: string, patch: Partial<Omit<MediaRecord, 'id' | 'createdAt'>>): Promise<MediaRecord>
  findById(id: string): Promise<MediaRecord | null>
  findByUuid(uuid: string): Promise<MediaRecord | null>
  findForModel(modelType: string, modelId: string, collection?: string): Promise<MediaRecord[]>
  delete(id: string): Promise<void>
  setOrder(ids: string[], startAt?: number): Promise<void>
  iterateAll(filter?: MediaFilter): AsyncIterable<MediaRecord>
  ownerExists(modelType: string, modelId: string): Promise<boolean>
  /**
   * Merges `{ [name]: generated }` into the record's `generatedConversions`
   * map. Unlike a read→`update()` round-trip in the caller, the read-merge-
   * write happens inside the repository, so the adapter can serialize it
   * where its backend allows (e.g. a single-threaded in-memory map, or
   * SQLite's single-writer model) — two concurrent calls for different names
   * are then guaranteed to both persist. Adapters whose backend cannot fully
   * serialize this read-merge-write (e.g. a read-committed SQL database
   * without row locks, where `$transaction`-wrapped read-then-write doesn't
   * block a concurrent transaction from reading the same pre-update row)
   * narrow the lost-update window but may not eliminate it — see the
   * adapter's own docs for its actual guarantee.
   */
  markConversionGenerated(id: string, name: string, generated: boolean): Promise<MediaRecord>
  /** Same contract for `responsiveImages[conversion] = entry`. */
  mergeResponsiveImages(id: string, conversion: string, entry: JsonObject): Promise<MediaRecord>
  /** Atomically set a single custom property key, preserving sibling keys. */
  setCustomProperty(id: string, key: string, value: unknown): Promise<MediaRecord>
  /** Atomically remove a single custom property key, preserving sibling keys. */
  removeCustomProperty(id: string, key: string): Promise<MediaRecord>
}
