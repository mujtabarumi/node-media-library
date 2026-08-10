import { describe } from 'vitest'
import { runStorageCycleContract } from '../src/testing/storage-contract.js'

const endpoint = process.env.S3_ENDPOINT
if (!endpoint) console.warn('[storage tests] S3_ENDPOINT not set — MinIO cycle contract skipped')

// MinIO needs path-style addressing and accepts ACLs, so this run proves the
// generic s3 wire protocol — NOT R2's ACL suppression or checksum handling.
// Only storage-r2.test.ts can prove those.
describe.skipIf(!endpoint)('minio (requires S3_ENDPOINT)', () => {
  runStorageCycleContract('minio', {
    disk: {
      driver: 's3',
      bucket: process.env.S3_BUCKET ?? 'media-test',
      region: 'us-east-1',
      endpoint: endpoint!,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
      },
    },
  })
})
