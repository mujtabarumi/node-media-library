import type { Disk } from 'flydrive'
import { StorageError } from '../errors.js'

/**
 * Write options for a `disk.put()`/`disk.putStream()` call, derived from
 * whether the owning collection was marked `.public()`. Public collections
 * pass `{ visibility: 'public' }` through to flydrive so the driver writes
 * the object with public ACLs/permissions; non-public collections pass
 * `undefined` so the disk's own configured default (private, per
 * `resolveStorage`'s `synthesizeDefaultDisk`) applies unchanged.
 * @internal
 */
export function writeOptionsFor(isPublicCollection: boolean): { visibility: 'public' } | undefined {
  return isPublicCollection ? { visibility: 'public' } : undefined
}

/**
 * Static S3 credentials. Declared structurally rather than imported from
 * `@aws-sdk/client-s3`, which is an *optional* peer — a type import would
 * break `tsc` for every fs/gcs consumer who never installed the AWS SDK.
 * The shape is structurally compatible with the SDK's own credentials
 * object, so it passes through unchanged.
 */
export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export type DiskConfig =
  | { driver: 'fs'; root: string; visibility?: 'public' | 'private'; baseUrl?: string }
  | {
      driver: 's3'
      bucket: string
      region?: string
      endpoint?: string
      /** Static credentials. Omit to use the AWS SDK's default provider chain. */
      credentials?: S3Credentials
      /**
       * Whether the backend implements object ACLs. Leave unset for AWS S3.
       * Set `false` for backends without ACL support — flydrive then skips the
       * `x-amz-acl` header on every write. Cloudflare R2 requires `false`;
       * `driver: 'r2'` forces it for you.
       */
      supportsACL?: boolean
      /** Path-style addressing (`host/bucket/key`). Required by MinIO. */
      forcePathStyle?: boolean
      /**
       * Passed through to the AWS SDK, and mirrors its own casing. Current
       * SDK versions default to `'WHEN_SUPPORTED'`, computing a CRC32
       * checksum on every PutObject, which some S3-compatible backends
       * reject. Set `'WHEN_REQUIRED'` if a backend rejects checksummed
       * writes.
       */
      requestChecksumCalculation?: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
      visibility?: 'public' | 'private'
      baseUrl?: string
    }
  | {
      driver: 'r2'
      /** Cloudflare account ID. Derives the S3 API endpoint. */
      accountId: string
      bucket: string
      /** Static R2 credentials. Omit to use the AWS SDK's default provider chain. */
      credentials?: S3Credentials
      /**
       * Overrides the endpoint derived from `accountId`. Needed for R2's EU
       * jurisdiction, whose host differs from the default.
       */
      endpoint?: string
      visibility?: 'public' | 'private'
      /**
       * Public URL base — an `https://pub-….r2.dev` subdomain or a custom
       * domain. R2 has no object ACLs, so this is the *only* way to produce
       * working public URLs; a `.public()` collection on an r2 disk without
       * it throws when the MediaLibrary is constructed.
       */
      baseUrl?: string
    }
  | {
      driver: 'gcs'
      bucket: string
      visibility?: 'public' | 'private'
      usingUniformAcl?: boolean
      projectId?: string
      keyFilename?: string
      credentials?: Record<string, unknown>
      baseUrl?: string
    }

export interface StorageConfig {
  default?: string
  prefix?: string
  disks?: Record<string, DiskConfig>
}

/**
 * The storage layer a `MediaLibrary` resolved from its config. Public because
 * `MediaLibrary.storage` returns it — typed code against that getter needs the
 * name. Constructing one is not part of the public surface; `resolveStorage`
 * stays internal.
 */
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
  if (env.MEDIA_R2_ACCOUNT_ID) {
    if (!env.MEDIA_R2_BUCKET) {
      throw new StorageError(
        'MEDIA_R2_ACCOUNT_ID is set without MEDIA_R2_BUCKET. Set both, or unset both — falling ' +
          'through to another driver here would silently store media somewhere you did not mean.',
      )
    }
    return {
      driver: 'r2',
      accountId: env.MEDIA_R2_ACCOUNT_ID,
      bucket: env.MEDIA_R2_BUCKET,
      visibility: 'private',
      ...(env.MEDIA_R2_BASE_URL ? { baseUrl: env.MEDIA_R2_BASE_URL } : {}),
      ...(env.MEDIA_R2_ACCESS_KEY_ID && env.MEDIA_R2_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: env.MEDIA_R2_ACCESS_KEY_ID,
              secretAccessKey: env.MEDIA_R2_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    }
  }
  if (env.MEDIA_S3_BUCKET) {
    return {
      driver: 's3',
      bucket: env.MEDIA_S3_BUCKET,
      region: env.MEDIA_S3_REGION,
      endpoint: env.MEDIA_S3_ENDPOINT,
      visibility: 'private',
    }
  }
  if (env.MEDIA_GCS_BUCKET) {
    return { driver: 'gcs', bucket: env.MEDIA_GCS_BUCKET, visibility: 'private' }
  }
  return {
    driver: 'fs',
    root: env.MEDIA_FS_ROOT ?? './storage/media',
    visibility: 'private',
    ...(env.MEDIA_FS_BASE_URL ? { baseUrl: env.MEDIA_FS_BASE_URL } : {}),
  }
}

/**
 * Normalizes an `r2` disk config into the `s3` shape the driver branch
 * consumes, so exactly one code path constructs an S3Driver.
 *
 * `supportsACL` is *forced* rather than defaulted: R2 does not implement
 * object ACLs, so there is no valid R2 configuration with them enabled, and
 * accepting the option would only let a caller build a broken disk.
 *
 * `requestChecksumCalculation` is deliberately left unset — the AWS SDK's
 * own default applies until the live R2 suite proves it needs overriding.
 * @internal
 */
export function normalizeR2(
  cfg: Extract<DiskConfig, { driver: 'r2' }>,
): Extract<DiskConfig, { driver: 's3' }> {
  return {
    driver: 's3',
    bucket: cfg.bucket,
    region: 'auto',
    endpoint: cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    supportsACL: false,
    visibility: cfg.visibility ?? 'private',
    ...(cfg.credentials ? { credentials: cfg.credentials } : {}),
    ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
  }
}

/** @internal */
export function resolveStorage(
  config?: StorageConfig,
  env: Record<string, string | undefined> = process.env,
): ResolvedStorage {
  const defaultDisk = config?.default ?? 'default'
  const prefix = config?.prefix ?? env.MEDIA_PREFIX ?? ''
  const disks: Record<string, DiskConfig> = config?.disks ?? {
    [defaultDisk]: synthesizeDefaultDisk(env),
  }

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

    // Normalize before the branches below: `disk()` used to treat "not fs and
    // not s3" as gcs, so an unnormalized r2 config would have constructed a
    // GCSDriver with no type error at all.
    const raw = diskConfig(diskName)
    const cfg = raw.driver === 'r2' ? normalizeR2(raw) : raw
    const { Disk: DiskCtor } = await import('flydrive')

    if (cfg.driver === 'fs') {
      const { FSDriver } = await import('flydrive/drivers/fs')
      const instance = new DiskCtor(
        new FSDriver({ location: cfg.root, visibility: cfg.visibility ?? 'private' }),
      )
      cache.set(diskName, instance)
      return instance
    }

    if (cfg.driver === 's3') {
      const { S3Driver } = await import('flydrive/drivers/s3')
      const instance = new DiskCtor(
        new S3Driver({
          bucket: cfg.bucket,
          region: cfg.region,
          endpoint: cfg.endpoint,
          visibility: cfg.visibility ?? 'private',
          // Spread conditionally rather than passing `undefined`: an explicit
          // `credentials: undefined` is fine for the SDK, but the same is not
          // true of every option here, and this matches the gcs branch's style.
          ...(cfg.credentials ? { credentials: cfg.credentials } : {}),
          ...(cfg.supportsACL !== undefined ? { supportsACL: cfg.supportsACL } : {}),
          ...(cfg.forcePathStyle !== undefined ? { forcePathStyle: cfg.forcePathStyle } : {}),
          ...(cfg.requestChecksumCalculation
            ? { requestChecksumCalculation: cfg.requestChecksumCalculation }
            : {}),
        }),
      )
      cache.set(diskName, instance)
      return instance
    }

    if (cfg.driver === 'gcs') {
      const { GCSDriver } = await import('flydrive/drivers/gcs')
      const {
        bucket,
        visibility = 'private',
        usingUniformAcl,
        projectId,
        keyFilename,
        credentials,
      } = cfg
      const instance = new DiskCtor(
        new GCSDriver({
          bucket,
          visibility,
          ...(usingUniformAcl !== undefined ? { usingUniformAcl } : {}),
          ...(projectId ? { projectId } : {}),
          ...(keyFilename ? { keyFilename } : {}),
          ...(credentials ? { credentials } : {}),
        }),
      )
      cache.set(diskName, instance)
      return instance
    }

    throw new StorageError(
      `Unsupported disk driver "${(cfg as { driver: string }).driver}" on disk "${diskName}"`,
    )
  }

  return { defaultDisk, prefix, disk, diskConfig }
}
