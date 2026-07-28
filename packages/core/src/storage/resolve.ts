import type { Disk } from 'flydrive'
import { StorageError } from '../errors.js'

/**
 * Write options for a `disk.put()`/`disk.putStream()` call, derived from
 * whether the owning collection was marked `.public()`. Public collections
 * pass `{ visibility: 'public' }` through to flydrive so the driver writes
 * the object with public ACLs/permissions; non-public collections pass
 * `undefined` so the disk's own configured default (private, per
 * `resolveStorage`'s `synthesizeDefaultDisk`) applies unchanged.
 */
export function writeOptionsFor(isPublicCollection: boolean): { visibility: 'public' } | undefined {
  return isPublicCollection ? { visibility: 'public' } : undefined
}

export type DiskConfig =
  | { driver: 'fs'; root: string; visibility?: 'public' | 'private'; baseUrl?: string }
  | {
      driver: 's3'
      bucket: string
      region?: string
      endpoint?: string
      visibility?: 'public' | 'private'
      baseUrl?: string
    }

export interface StorageConfig {
  default?: string
  prefix?: string
  disks?: Record<string, DiskConfig>
}

export interface ResolvedStorage {
  defaultDisk: string
  prefix: string
  /** Lazily creates (and memoizes) the flydrive Disk for the named disk. */
  disk(name?: string): Promise<Disk>
  diskConfig(name?: string): DiskConfig
}

const PRODUCTION_FS_WARNING =
  '[media-library] Media is stored on the local filesystem in production. Configure S3-compatible storage for durability.'

function synthesizeDefaultDisk(env: Record<string, string | undefined>): DiskConfig {
  if (env.MEDIA_S3_BUCKET) {
    return {
      driver: 's3',
      bucket: env.MEDIA_S3_BUCKET,
      region: env.MEDIA_S3_REGION,
      endpoint: env.MEDIA_S3_ENDPOINT,
      visibility: 'private',
    }
  }
  return {
    driver: 'fs',
    root: env.MEDIA_FS_ROOT ?? './storage/media',
    visibility: 'private',
  }
}

export function resolveStorage(
  config?: StorageConfig,
  env: Record<string, string | undefined> = process.env,
): ResolvedStorage {
  const defaultDisk = config?.default ?? 'default'
  const prefix = config?.prefix ?? env.MEDIA_PREFIX ?? ''
  const disks: Record<string, DiskConfig> =
    config?.disks ?? { [defaultDisk]: synthesizeDefaultDisk(env) }

  if (env.NODE_ENV === 'production' && disks[defaultDisk]?.driver === 'fs') {
    console.warn(PRODUCTION_FS_WARNING)
  }

  const cache = new Map<string, Disk>()

  function diskConfig(name?: string): DiskConfig {
    const diskName = name ?? defaultDisk
    const cfg = disks[diskName]
    if (!cfg) {
      throw new StorageError(`Unknown disk "${diskName}"`)
    }
    return cfg
  }

  async function disk(name?: string): Promise<Disk> {
    const diskName = name ?? defaultDisk
    const cached = cache.get(diskName)
    if (cached) return cached

    const cfg = diskConfig(diskName)
    const { Disk: DiskCtor } = await import('flydrive')

    if (cfg.driver === 'fs') {
      const { FSDriver } = await import('flydrive/drivers/fs')
      const instance = new DiskCtor(
        new FSDriver({ location: cfg.root, visibility: cfg.visibility ?? 'private' }),
      )
      cache.set(diskName, instance)
      return instance
    }

    const { S3Driver } = await import('flydrive/drivers/s3')
    const instance = new DiskCtor(
      new S3Driver({
        bucket: cfg.bucket,
        region: cfg.region,
        endpoint: cfg.endpoint,
        visibility: cfg.visibility ?? 'private',
      }),
    )
    cache.set(diskName, instance)
    return instance
  }

  return { defaultDisk, prefix, disk, diskConfig }
}
