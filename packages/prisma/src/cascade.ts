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

          const result = await query(args)

          for (const row of rows) {
            await media.clearFor(model, String(row.id))
          }

          return result
        },
      },
    },
  }) as C
}
