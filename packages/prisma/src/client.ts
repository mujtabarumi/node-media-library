export interface MediaRow {
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
  manipulations: unknown
  customProperties: unknown
  generatedConversions: unknown
  responsiveImages: unknown
  orderColumn: number | null
  createdAt: Date
  updatedAt: Date
}

export interface MediaDelegate {
  create(args: { data: Record<string, unknown> }): Promise<MediaRow>
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<MediaRow>
  updateMany(args: {
    where: Record<string, unknown>
    data: Record<string, unknown>
  }): Promise<{ count: number }>
  findUnique(args: { where: Record<string, unknown> }): Promise<MediaRow | null>
  findMany(args?: Record<string, unknown>): Promise<MediaRow[]>
  delete(args: { where: { id: string } }): Promise<MediaRow>
  deleteMany(args?: Record<string, unknown>): Promise<{ count: number }>
}

export interface PrismaLikeClient {
  media: MediaDelegate
  /**
   * Prisma's interactive-transaction API. Optional: when present (any real
   * PrismaClient), the JSON merge methods run their read-merge-write inside
   * it; when absent, they fall back to a plain read-merge-write (documented
   * residual race for exotic clients that lack transactions).
   */
  $transaction?<T>(fn: (tx: { media: MediaDelegate }) => Promise<T>): Promise<T>
}
