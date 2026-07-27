import { MediaLibraryError } from '@node-media-library/core'
import type { MediaFilter, MediaRecord, MediaRepository, NewMediaRecord } from '@node-media-library/core'
import type { PrismaLikeClient } from './client.js'
import { toCreateData, toMediaRecord } from './mapping.js'

export interface PrismaAdapterOptions {
  owners?: Record<string, (modelId: string) => boolean | Promise<boolean>>
  iterateBatchSize?: number
}

function prismaErrorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined
}

const FIND_FOR_MODEL_ORDER = [{ orderColumn: { sort: 'asc' as const, nulls: 'last' as const } }, { createdAt: 'asc' as const }]

class PrismaMediaRepository implements MediaRepository {
  private readonly batchSize: number

  constructor(
    private readonly client: PrismaLikeClient,
    private readonly opts: PrismaAdapterOptions = {},
  ) {
    this.batchSize = opts.iterateBatchSize ?? 100
  }

  async create(data: NewMediaRecord): Promise<MediaRecord> {
    try {
      const row = await this.client.media.create({ data: toCreateData(data) })
      return toMediaRecord(row)
    } catch (e) {
      if (prismaErrorCode(e) === 'P2002') {
        throw new MediaLibraryError(`Media record with id "${data.id}" already exists`, 'DUPLICATE_ID')
      }
      throw e
    }
  }

  async update(id: string, patch: Partial<Omit<MediaRecord, 'id' | 'createdAt'>>): Promise<MediaRecord> {
    try {
      const row = await this.client.media.update({ where: { id }, data: { ...patch } })
      return toMediaRecord(row)
    } catch (e) {
      if (prismaErrorCode(e) === 'P2025') {
        throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
      }
      throw e
    }
  }

  async findById(id: string): Promise<MediaRecord | null> {
    const row = await this.client.media.findUnique({ where: { id } })
    return row ? toMediaRecord(row) : null
  }

  async findByUuid(uuid: string): Promise<MediaRecord | null> {
    const row = await this.client.media.findUnique({ where: { uuid } })
    return row ? toMediaRecord(row) : null
  }

  async findForModel(modelType: string, modelId: string, collection?: string): Promise<MediaRecord[]> {
    const where: Record<string, unknown> = { modelType, modelId }
    if (collection !== undefined) where.collectionName = collection
    const rows = await this.client.media.findMany({ where, orderBy: FIND_FOR_MODEL_ORDER })
    return rows.map(toMediaRecord)
  }

  async delete(id: string): Promise<void> {
    try {
      await this.client.media.delete({ where: { id } })
    } catch (e) {
      if (prismaErrorCode(e) === 'P2025') return
      throw e
    }
  }

  async setOrder(ids: string[], startAt: number = 1): Promise<void> {
    let order = startAt
    for (const id of ids) {
      await this.client.media.updateMany({ where: { id }, data: { orderColumn: order } })
      order += 1
    }
  }

  async *iterateAll(filter?: MediaFilter): AsyncIterable<MediaRecord> {
    const where: Record<string, unknown> = {}
    if (filter?.modelType !== undefined) where.modelType = filter.modelType
    if (filter?.collectionName !== undefined) where.collectionName = filter.collectionName

    let lastId: string | undefined
    for (;;) {
      const rows = await this.client.media.findMany({
        where,
        orderBy: [...FIND_FOR_MODEL_ORDER, { id: 'asc' as const }],
        take: this.batchSize,
        ...(lastId !== undefined ? { cursor: { id: lastId }, skip: 1 } : {}),
      })
      if (rows.length === 0) return
      for (const row of rows) {
        yield toMediaRecord(row)
      }
      lastId = rows[rows.length - 1]!.id
      if (rows.length < this.batchSize) return
    }
  }

  async ownerExists(modelType: string, modelId: string): Promise<boolean> {
    const check = this.opts.owners?.[modelType]
    if (!check) return true
    return check(modelId)
  }
}

export function prismaAdapter(client: PrismaLikeClient, opts?: PrismaAdapterOptions): MediaRepository {
  return new PrismaMediaRepository(client, opts)
}
