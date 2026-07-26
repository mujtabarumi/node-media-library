import { MediaRecord, NewMediaRecord } from './types.js'

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
}
