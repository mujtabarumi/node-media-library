import type { MediaLibrary } from '@node-media-library/core'
import type { PrismaLikeClient } from './client.js'

export interface CascadeOptions {
  models?: string[]
}

interface CascadeQueryArgs {
  model: string
  args: unknown
  query: (args: unknown) => Promise<unknown>
}

function modelKey(model: string): string {
  return model.length === 0 ? model : model[0]!.toLowerCase() + model.slice(1)
}

function hasStringableId(value: unknown): value is { id: string | number } {
  return typeof value === 'object' && value !== null && 'id' in value
}

export function withMediaCascade<C extends PrismaLikeClient & { $extends(ext: unknown): unknown }>(
  client: C,
  media: MediaLibrary,
  opts?: CascadeOptions,
): C {
  const scope = new Set(opts?.models ?? media.modelTypes)

  return client.$extends({
    query: {
      $allModels: {
        async delete({ model, args, query }: CascadeQueryArgs) {
          // Owner row is removed first by design: if clearFor then throws, the
          // media rows/files are orphaned but recoverable (re-run cleanup),
          // whereas rolling back a resurrected owner row would not be.
          //
          // Honesty note: `hasStringableId(result)` requires `result.id` to
          // be present on the deleted row. If the caller's `delete()` args
          // include a `select` that omits `id` (e.g. `select: { name: true }`
          // without `id`), `result` won't carry an id and this cascade is
          // silently skipped for that call — the owner row is still deleted,
          // but its media is orphaned with no cleanup triggered.
          const result = await query(args)
          if (scope.has(model) && hasStringableId(result)) {
            await media.clearFor(model, String(result.id))
          }
          return result
        },
        async deleteMany({ model, args, query }: CascadeQueryArgs) {
          if (!scope.has(model)) {
            return query(args)
          }

          // Honesty note: this reads the matching rows via `findMany` BEFORE
          // `query(args)` runs the actual `deleteMany`, then cascades over
          // that snapshot. A row that matches `where` but is created (or
          // starts matching) between the `findMany` and the `deleteMany` —
          // e.g. a concurrent insert/update racing this call — can be
          // deleted by `query(args)` without ever appearing in `rows`, so
          // its media is never cascaded. There is no transaction wrapping
          // both calls here; a Prisma interactive transaction around this
          // extension would close that window but isn't what's wired up.
          const where = (args as { where?: unknown } | undefined)?.where
          const delegates = client as unknown as Record<
            string,
            { findMany(args: unknown): Promise<Array<{ id: string | number }>> }
          >
          const delegate = delegates[modelKey(model)]
          if (!delegate) {
            throw new Error(`No delegate found for model "${model}"`)
          }
          const rows = await delegate.findMany({ where, select: { id: true } })

          // Same ordering rationale as delete(): owner rows go first, media
          // cleanup after, so a mid-failure leaves orphaned-but-recoverable
          // media rather than an un-rollback-able resurrected owner.
          const result = await query(args)

          for (const row of rows) {
            await media.clearFor(model, String(row.id))
          }

          return result
        },
      },
    },
    // $extends returns a structurally different type than C, and without
    // importing the generated Prisma client type no inference can bridge
    // that — this cast is the deliberate, duck-typing-preserving escape hatch.
  }) as C
}
