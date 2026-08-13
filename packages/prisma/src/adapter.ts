import { MediaLibraryError, matchesMediaFilter } from '@node-media-library/core'
import type {
  JsonObject,
  MediaFilter,
  MediaRecord,
  MediaRepository,
  NewMediaRecord,
} from '@node-media-library/core'
import type { MediaDelegate, PrismaLikeClient } from './client.js'
import { toCreateData, toMediaRecord } from './mapping.js'

export interface PrismaAdapterOptions {
  owners?: Record<string, (modelId: string) => boolean | Promise<boolean>>
  iterateBatchSize?: number
  /**
   * Push `MediaFilter.customProperties` into the SQL `where` clause using this
   * database's JSON path syntax. PostgreSQL takes an array path
   * (`['storeId']`); MySQL and SQLite take a string path (`'$.storeId'`).
   * Prisma does not normalize the two, and this adapter is structurally typed
   * — it never imports `@prisma/client` and cannot detect your provider — so
   * naming the dialect is your call.
   *
   * Only keys that are simple identifiers (`/^[A-Za-z_$][A-Za-z0-9_$]*$/`) are
   * pushed down. A key containing `.`, `"`, `[`, whitespace, or any other
   * character with meaning in a JSON path would silently change what the
   * interpolated `$.${key}` path selects (e.g. `'a.b'` becomes the nested
   * path `$.a.b`), so such keys always fall back to application-side
   * filtering instead of being interpolated into SQL.
   *
   * Omit it to filter in the application instead. That is correct on every
   * provider, but it reads every row matching `modelType`/`collectionName`
   * before discarding non-matches.
   *
   * Setting the wrong dialect surfaces as a `PrismaClientValidationError` on
   * the first filtered `iterateAll`, not as a type error.
   */
  jsonPathStyle?: 'postgres' | 'mysql'
}

function prismaErrorCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e
    ? String((e as { code: unknown }).code)
    : undefined
}

function prismaErrorTargetFields(e: unknown): string[] | undefined {
  if (typeof e !== 'object' || e === null || !('meta' in e)) return undefined
  const meta = (e as { meta?: unknown }).meta
  if (typeof meta !== 'object' || meta === null || !('target' in meta)) return undefined
  const target = (meta as { target?: unknown }).target
  if (!Array.isArray(target) || !target.every((t) => typeof t === 'string')) return undefined
  return target as string[]
}

function duplicateIdMessage(data: NewMediaRecord, e: unknown): string {
  const fields = prismaErrorTargetFields(e)
  if (fields && fields.length > 0) {
    const values = fields
      .map((f) => `${f} "${String((data as Record<string, unknown>)[f] ?? '')}"`)
      .join(', ')
    return `Media record with ${values} already exists`
  }
  return `Media record violates a unique constraint (id "${data.id}", uuid "${data.uuid}")`
}

const FIND_FOR_MODEL_ORDER = [
  { orderColumn: { sort: 'asc' as const, nulls: 'last' as const } },
  { createdAt: 'asc' as const },
]

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
        throw new MediaLibraryError(duplicateIdMessage(data, e), 'DUPLICATE_ID')
      }
      throw e
    }
  }

  async update(
    id: string,
    patch: Partial<Omit<MediaRecord, 'id' | 'createdAt'>>,
  ): Promise<MediaRecord> {
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

  async findForModel(
    modelType: string,
    modelId: string,
    collection?: string,
  ): Promise<MediaRecord[]> {
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
    const filterWhere: Record<string, unknown> = {}
    if (filter?.modelType !== undefined) filterWhere.modelType = filter.modelType
    if (filter?.collectionName !== undefined) filterWhere.collectionName = filter.collectionName

    // customProperties reaches SQL only when the consumer named their dialect
    // (see PrismaAdapterOptions.jsonPathStyle), and even then only for scalar
    // values (string/number/boolean): Prisma's JSON `equals` is unambiguous
    // for those, but not guaranteed to match this library's deep-equality
    // semantics for objects, arrays, or null (null in particular usually
    // needs a Prisma.JsonNull/DbNull sentinel, not a literal `null`, and
    // array/object `equals` behavior is not guaranteed consistent across
    // connectors). Non-scalar keys are always applied per row below.
    //
    // A key is ALSO held back from push-down (regardless of its value's
    // type) unless it is a safe identifier. The path is built by raw
    // interpolation (`$.${key}`) below, so a key containing `.`, `"`, `[`, or
    // whitespace would silently change which path is queried (`'a.b'` would
    // become the nested path `$.a.b`) rather than erroring — held-back keys
    // are filtered by matchesMediaFilter instead, which reads the literal
    // key.
    const SAFE_JSON_PATH_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/
    const style = this.opts.jsonPathStyle
    const entries = filter?.customProperties ? Object.entries(filter.customProperties) : []
    const pushableEntries = entries.filter(
      ([key, value]) =>
        SAFE_JSON_PATH_KEY.test(key) &&
        (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'),
    )
    // Only skip the per-row check below when every key was pushed down —
    // if even one key was held back (non-scalar or an unsafe key),
    // matchesMediaFilter is the sole authority for it and must run on every
    // yielded row.
    const allPushedDown =
      style !== undefined && entries.length > 0 && pushableEntries.length === entries.length
    if (style !== undefined && pushableEntries.length > 0) {
      filterWhere.AND = pushableEntries.map(([key, value]) => ({
        customProperties: {
          path: style === 'postgres' ? [key] : `$.${key}`,
          equals: value,
        },
      }))
    }

    // Keyset pagination on id (not cursor+skip): a row can be deleted between
    // batches (e.g. Plan 6's clean command iterates and deletes concurrently),
    // and cursor+skip would silently truncate if the cursor row itself is gone.
    // `id > lastId` needs no row to still exist, only the last-seen id value.
    let lastId: string | undefined
    for (;;) {
      const where = lastId !== undefined ? { ...filterWhere, id: { gt: lastId } } : filterWhere
      const rows = await this.client.media.findMany({
        where,
        orderBy: { id: 'asc' as const },
        take: this.batchSize,
      })
      if (rows.length === 0) return
      for (const row of rows) {
        const record = toMediaRecord(row)
        // Batch termination below counts rows FETCHED, not yielded, so
        // post-filtering here cannot truncate the iteration early.
        if (allPushedDown || matchesMediaFilter(record, filter)) {
          yield record
        }
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

  /**
   * With `$transaction`, the read-merge-write below runs transactionally,
   * but that alone does not make it atomic against concurrent merges on the
   * SAME record: Postgres and MySQL's default isolation (read committed) does
   * not take a row lock on a plain `findUnique` read, so a second concurrent
   * `mergeJsonColumn` transaction can read the same pre-update row and, when
   * both commit, one write can still be lost. SQLite serializes all writes
   * (single-writer), so it does not have this gap — the contract's
   * concurrency guarantee holds there but is not proven for Postgres/MySQL.
   */
  private async mergeJsonColumn(
    id: string,
    column: 'generatedConversions' | 'responsiveImages' | 'customProperties',
    key: string,
    value: unknown,
  ): Promise<MediaRecord> {
    const run = async (tx: { media: MediaDelegate }) => {
      const row = await tx.media.findUnique({ where: { id } })
      if (!row) {
        throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
      }
      const current = (row[column] ?? {}) as Record<string, unknown>
      return tx.media.update({ where: { id }, data: { [column]: { ...current, [key]: value } } })
    }
    const row = this.client.$transaction
      ? await this.client.$transaction(run)
      : await run(this.client)
    return toMediaRecord(row)
  }

  async markConversionGenerated(
    id: string,
    name: string,
    generated: boolean,
  ): Promise<MediaRecord> {
    return this.mergeJsonColumn(id, 'generatedConversions', name, generated)
  }

  async mergeResponsiveImages(
    id: string,
    conversion: string,
    entry: JsonObject,
  ): Promise<MediaRecord> {
    return this.mergeJsonColumn(id, 'responsiveImages', conversion, entry)
  }

  async setCustomProperty(id: string, key: string, value: unknown): Promise<MediaRecord> {
    return this.mergeJsonColumn(id, 'customProperties', key, value)
  }

  /**
   * Same read-merge-write shape as mergeJsonColumn but deletes the key.
   * Shares mergeJsonColumn's honesty caveat: inside $transaction when the
   * client provides one, but not lock-safe on read-committed Postgres/MySQL.
   */
  async removeCustomProperty(id: string, key: string): Promise<MediaRecord> {
    const run = async (tx: { media: MediaDelegate }) => {
      const row = await tx.media.findUnique({ where: { id } })
      if (!row) {
        throw new MediaLibraryError(`Media record with id "${id}" was not found`, 'NOT_FOUND')
      }
      const current = { ...((row.customProperties ?? {}) as Record<string, unknown>) }
      delete current[key]
      return tx.media.update({ where: { id }, data: { customProperties: current } })
    }
    const row = this.client.$transaction
      ? await this.client.$transaction(run)
      : await run(this.client)
    return toMediaRecord(row)
  }
}

export function prismaAdapter(
  client: PrismaLikeClient,
  opts?: PrismaAdapterOptions,
): MediaRepository {
  return new PrismaMediaRepository(client, opts)
}
