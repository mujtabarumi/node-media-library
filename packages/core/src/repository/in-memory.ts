import { MediaLibraryError } from '../errors.js'
import { JsonObject, MediaRecord, NewMediaRecord } from '../types.js'
import { MediaFilter, MediaRepository } from '../repository.js'

export function compareMediaOrder(a: MediaRecord, b: MediaRecord): number {
  if (a.orderColumn !== b.orderColumn) {
    if (a.orderColumn === null) return 1
    if (b.orderColumn === null) return -1
    return a.orderColumn - b.orderColumn
  }
  return a.createdAt.getTime() - b.createdAt.getTime()
}

export class InMemoryMediaRepository implements MediaRepository {
  private records = new Map<string, MediaRecord>()
  private ownerExistsFn: (type: string, id: string) => boolean

  constructor(opts?: { ownerExists?: (type: string, id: string) => boolean }) {
    this.ownerExistsFn = opts?.ownerExists ?? (() => true)
  }

  async create(data: NewMediaRecord): Promise<MediaRecord> {
    if (this.records.has(data.id)) {
      throw new MediaLibraryError(`Media record with id "${data.id}" already exists`, 'DUPLICATE_ID')
    }
    const now = new Date()
    const record: MediaRecord = { ...data, createdAt: now, updatedAt: now }
    this.records.set(record.id, record)
    return record
  }

  async update(id: string, patch: Partial<Omit<MediaRecord, 'id' | 'createdAt'>>): Promise<MediaRecord> {
    const existing = this.records.get(id)
    if (!existing) {
      throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
    }
    const updated: MediaRecord = { ...existing, ...patch, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date() }
    this.records.set(id, updated)
    return updated
  }

  async findById(id: string): Promise<MediaRecord | null> {
    return this.records.get(id) ?? null
  }

  async findByUuid(uuid: string): Promise<MediaRecord | null> {
    for (const record of this.records.values()) {
      if (record.uuid === uuid) return record
    }
    return null
  }

  async findForModel(modelType: string, modelId: string, collection?: string): Promise<MediaRecord[]> {
    const matches = [...this.records.values()].filter((record) => {
      if (record.modelType !== modelType || record.modelId !== modelId) return false
      if (collection !== undefined && record.collectionName !== collection) return false
      return true
    })
    return matches.sort(compareMediaOrder)
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id)
  }

  async setOrder(ids: string[], startAt: number = 1): Promise<void> {
    let order = startAt
    for (const id of ids) {
      const existing = this.records.get(id)
      if (!existing) continue
      this.records.set(id, { ...existing, orderColumn: order, updatedAt: new Date() })
      order += 1
    }
  }

  async *iterateAll(filter?: MediaFilter): AsyncIterable<MediaRecord> {
    const matches = [...this.records.values()]
      .filter((record) => {
        if (filter?.modelType !== undefined && record.modelType !== filter.modelType) return false
        if (filter?.collectionName !== undefined && record.collectionName !== filter.collectionName) return false
        return true
      })
      .sort(compareMediaOrder)
    for (const record of matches) {
      yield record
    }
  }

  async ownerExists(modelType: string, modelId: string): Promise<boolean> {
    return this.ownerExistsFn(modelType, modelId)
  }

  async markConversionGenerated(id: string, name: string, generated: boolean): Promise<MediaRecord> {
    const existing = this.records.get(id)
    if (!existing) {
      throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
    }
    const updated: MediaRecord = {
      ...existing,
      generatedConversions: { ...existing.generatedConversions, [name]: generated },
      updatedAt: new Date(),
    }
    this.records.set(id, updated)
    return updated
  }

  async mergeResponsiveImages(id: string, conversion: string, entry: JsonObject): Promise<MediaRecord> {
    const existing = this.records.get(id)
    if (!existing) {
      throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
    }
    const updated: MediaRecord = {
      ...existing,
      responsiveImages: { ...existing.responsiveImages, [conversion]: entry },
      updatedAt: new Date(),
    }
    this.records.set(id, updated)
    return updated
  }

  async setCustomProperty(id: string, key: string, value: unknown): Promise<MediaRecord> {
    const existing = this.records.get(id)
    if (!existing) {
      throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
    }
    const updated: MediaRecord = {
      ...existing,
      customProperties: { ...existing.customProperties, [key]: value },
      updatedAt: new Date(),
    }
    this.records.set(id, updated)
    return updated
  }

  async removeCustomProperty(id: string, key: string): Promise<MediaRecord> {
    const existing = this.records.get(id)
    if (!existing) {
      throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
    }
    const customProperties = { ...existing.customProperties }
    delete customProperties[key]
    const updated: MediaRecord = { ...existing, customProperties, updatedAt: new Date() }
    this.records.set(id, updated)
    return updated
  }
}
