import { describe, expect, it } from 'vitest'
import { resolveStorage } from '../src/storage/resolve.js'

/**
 * A structurally-typed view onto flydrive's `S3Driver.options` — the public field where the
 * driver stores its constructor argument verbatim (`this.options = options`, unmodified). This
 * is the one genuinely observable way to prove that resolve.ts's conditional-spread forwarding
 * actually reaches the driver:
 * - `getUrl()`/`getVisibility()` never consult `credentials`, `supportsACL`, `forcePathStyle`,
 *   or `requestChecksumCalculation` once an `endpoint` is configured (flydrive's S3Driver reads
 *   only `this.#client.config.endpoint` for URL building), and
 * - `new S3Client(options)` does not throw on a missing/incorrect option,
 * so neither can catch a forwarding regression. `Disk.driver` and `S3Driver.options` are both
 * public (not `#private`), so reading them is not reaching into private state — it's reading
 * the driver's own declared public surface, just not through a type import from the optional
 * `@aws-sdk/client-s3` peer.
 */
interface ForwardedS3DriverOptions {
  credentials?: unknown
  supportsACL?: boolean
  forcePathStyle?: boolean
  requestChecksumCalculation?: string
}

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

  it('forwards credentials, supportsACL, forcePathStyle and requestChecksumCalculation to the underlying S3Driver', async () => {
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

    const options = (disk.driver as unknown as { options: ForwardedS3DriverOptions }).options
    expect(options.credentials).toEqual({
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      sessionToken: 'st',
    })
    expect(options.supportsACL).toBe(false)
    expect(options.forcePathStyle).toBe(true)
    expect(options.requestChecksumCalculation).toBe('WHEN_REQUIRED')
  })

  it('memoizes the disk instance per name', async () => {
    const storage = resolveStorage({
      disks: { media: { driver: 's3', bucket: 'b', region: 'us-east-1' } },
      default: 'media',
    })
    expect(await storage.disk('media')).toBe(await storage.disk('media'))
  })
})
