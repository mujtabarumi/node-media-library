import { MediaRecord, NewMediaRecord } from '@node-media-library/core'
import { MediaRow } from './client.js'

export function toMediaRecord(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    modelType: row.modelType,
    modelId: row.modelId,
    uuid: row.uuid,
    collectionName: row.collectionName,
    name: row.name,
    fileName: row.fileName,
    mimeType: row.mimeType,
    disk: row.disk,
    conversionsDisk: row.conversionsDisk,
    size: row.size,
    manipulations: (row.manipulations ?? {}) as MediaRecord['manipulations'],
    customProperties: (row.customProperties ?? {}) as MediaRecord['customProperties'],
    generatedConversions: (row.generatedConversions ?? {}) as MediaRecord['generatedConversions'],
    responsiveImages: (row.responsiveImages ?? {}) as MediaRecord['responsiveImages'],
    orderColumn: row.orderColumn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function toCreateData(data: NewMediaRecord): Record<string, unknown> {
  return { ...data }
}
