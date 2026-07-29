export type JsonObject = Record<string, unknown>
export interface MediaRecord {
  id: string
  modelType: string
  modelId: string
  uuid: string
  collectionName: string
  name: string
  fileName: string
  mimeType: string | null
  disk: string
  conversionsDisk: string | null
  size: number
  manipulations: Record<string, JsonObject>
  customProperties: JsonObject
  generatedConversions: Record<string, boolean>
  responsiveImages: JsonObject
  orderColumn: number | null
  createdAt: Date
  updatedAt: Date
}
export type NewMediaRecord = Omit<MediaRecord, 'createdAt' | 'updatedAt'>
export interface IncomingFile {
  fileName: string
  mimeType: string | null
  size: number
}
