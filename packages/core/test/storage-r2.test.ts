import { describe } from 'vitest'
import { runStorageCycleContract } from '../src/testing/storage-contract.js'

const accountId = process.env.R2_ACCOUNT_ID
const bucket = process.env.R2_BUCKET
const accessKeyId = process.env.R2_ACCESS_KEY_ID
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
const configured = Boolean(accountId && bucket && accessKeyId && secretAccessKey)
if (!configured) console.warn('[storage tests] R2_* not set — R2 cycle contract skipped')

// The authority on R2-specific behavior: ACL suppression (every write would
// otherwise carry x-amz-acl, which R2 rejects), checksum compatibility, and
// r2.dev/custom-domain serving. Dormant until repository secrets are added.
describe.skipIf(!configured)('cloudflare-r2 (requires R2_*)', () => {
  runStorageCycleContract('cloudflare-r2', {
    disk: {
      driver: 'r2',
      accountId: accountId!,
      bucket: bucket!,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
      ...(process.env.R2_BASE_URL ? { baseUrl: process.env.R2_BASE_URL } : {}),
    },
    ...(process.env.R2_BASE_URL ? { publicBaseUrl: process.env.R2_BASE_URL } : {}),
  })
})
