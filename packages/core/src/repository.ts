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
   * Atomically merges `{ [name]: generated }` into the record's
   * `generatedConversions` map. Unlike a read→`update()` round-trip in the
   * caller, the read-merge-write happens inside the repository, where the
   * adapter can serialize it (transaction, single-threaded map, ...), so two
   * concurrent calls for different names must both persist.
   */
  markConversionGenerated(id: string, name: string, generated: boolean): Promise<MediaRecord>
  /** Same contract for `responsiveImages[conversion] = entry`. */
  mergeResponsiveImages(id: string, conversion: string, entry: JsonObject): Promise<MediaRecord>
}
