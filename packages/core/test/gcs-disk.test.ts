import { describe, expect, it } from 'vitest'
import { resolveStorage } from '../src/storage/resolve.js'

describe('gcs disk driver', () => {
  it('resolves a gcs disk to a flydrive Disk backed by GCSDriver', async () => {
    const storage = resolveStorage({
      disks: { media: { driver: 'gcs', bucket: 'test-bucket' } },
      default: 'media',
    })
    const disk = await storage.disk('media')
    expect(disk).toBeDefined()
    // driver identity: getUrl is the observable contract. GCSDriver.getUrl
    // doesn't require live credentials (it builds a deterministic
    // storage.googleapis.com URL), but it URL-encodes the key's path
    // separators (`/` -> `%2F`), so assert against the decoded URL rather
    // than a literal substring match.
    const url = await disk.getUrl('some/key.png')
    expect(url).toContain('test-bucket')
    expect(decodeURIComponent(url)).toContain('some/key.png')
  })

  it('MEDIA_GCS_BUCKET synthesizes a private gcs default disk', () => {
    const storage = resolveStorage(undefined, { MEDIA_GCS_BUCKET: 'env-bucket' })
    expect(storage.diskConfig()).toMatchObject({
      driver: 'gcs',
      bucket: 'env-bucket',
      visibility: 'private',
    })
  })

  it('MEDIA_S3_BUCKET wins over MEDIA_GCS_BUCKET', () => {
    const storage = resolveStorage(undefined, { MEDIA_S3_BUCKET: 's3b', MEDIA_GCS_BUCKET: 'gb' })
    expect(storage.diskConfig()).toMatchObject({ driver: 's3', bucket: 's3b' })
  })
})
