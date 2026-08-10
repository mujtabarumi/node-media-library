import { describe, expect, it } from 'vitest'
import { resolveStorage } from '../src/storage/resolve.js'

describe('s3 disk driver', () => {
  it('resolves an s3 disk to a flydrive Disk backed by S3Driver', async () => {
    const storage = resolveStorage({
      disks: {
        media: {
          driver: 's3',
          bucket: 'test-bucket',
          region: 'us-east-1',
          endpoint: 'https://s3.example.com',
          credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
        },
      },
      default: 'media',
    })
    const disk = await storage.disk('media')
    // getUrl is the observable driver contract and needs no live credentials:
    // with an endpoint configured, S3Driver builds `endpoint + /bucket/key`.
    const url = await disk.getUrl('some/key.png')
    expect(url).toBe('https://s3.example.com/test-bucket/some/key.png')
  })

  it('forwards supportsACL, forcePathStyle and credentials without throwing', async () => {
    const storage = resolveStorage({
      disks: {
        media: {
          driver: 's3',
          bucket: 'b',
          region: 'us-east-1',
          endpoint: 'https://minio.example.com',
          credentials: { accessKeyId: 'ak', secretAccessKey: 'sk', sessionToken: 'st' },
          supportsACL: false,
          forcePathStyle: true,
          requestChecksumCalculation: 'WHEN_REQUIRED',
        },
      },
      default: 'media',
    })
    const disk = await storage.disk('media')
    expect(await disk.getUrl('k.png')).toBe('https://minio.example.com/b/k.png')
  })

  it('memoizes the disk instance per name', async () => {
    const storage = resolveStorage({
      disks: { media: { driver: 's3', bucket: 'b', region: 'us-east-1' } },
      default: 'media',
    })
    expect(await storage.disk('media')).toBe(await storage.disk('media'))
  })
})
