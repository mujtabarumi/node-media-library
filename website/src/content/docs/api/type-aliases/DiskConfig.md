---
title: 'DiskConfig'
editUrl: false
---
# Type Alias: DiskConfig

> **DiskConfig** = \{ `baseUrl?`: `string`; `driver`: `"fs"`; `root`: `string`; `visibility?`: `"public"` \| `"private"`; \} \| \{ `baseUrl?`: `string`; `bucket`: `string`; `credentials?`: [`S3Credentials`](/api/interfaces/S3Credentials/); `driver`: `"s3"`; `endpoint?`: `string`; `forcePathStyle?`: `boolean`; `region?`: `string`; `requestChecksumCalculation?`: `"WHEN_SUPPORTED"` \| `"WHEN_REQUIRED"`; `supportsACL?`: `boolean`; `visibility?`: `"public"` \| `"private"`; \} \| \{ `accountId`: `string`; `baseUrl?`: `string`; `bucket`: `string`; `credentials?`: [`S3Credentials`](/api/interfaces/S3Credentials/); `driver`: `"r2"`; `endpoint?`: `string`; `visibility?`: `"public"` \| `"private"`; \} \| \{ `baseUrl?`: `string`; `bucket`: `string`; `credentials?`: `Record`\<`string`, `unknown`\>; `driver`: `"gcs"`; `keyFilename?`: `string`; `projectId?`: `string`; `usingUniformAcl?`: `boolean`; `visibility?`: `"public"` \| `"private"`; \}

Defined in: [packages/core/src/storage/resolve.ts:30](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/resolve.ts#L30)

## Union Members

### Type Literal

\{ `baseUrl?`: `string`; `driver`: `"fs"`; `root`: `string`; `visibility?`: `"public"` \| `"private"`; \}

***

### Type Literal

\{ `baseUrl?`: `string`; `bucket`: `string`; `credentials?`: [`S3Credentials`](/api/interfaces/S3Credentials/); `driver`: `"s3"`; `endpoint?`: `string`; `forcePathStyle?`: `boolean`; `region?`: `string`; `requestChecksumCalculation?`: `"WHEN_SUPPORTED"` \| `"WHEN_REQUIRED"`; `supportsACL?`: `boolean`; `visibility?`: `"public"` \| `"private"`; \}

#### baseUrl?

> `optional` **baseUrl?**: `string`

#### bucket

> **bucket**: `string`

#### credentials?

> `optional` **credentials?**: [`S3Credentials`](/api/interfaces/S3Credentials/)

Static credentials. Omit to use the AWS SDK's default provider chain.

#### driver

> **driver**: `"s3"`

#### endpoint?

> `optional` **endpoint?**: `string`

#### forcePathStyle?

> `optional` **forcePathStyle?**: `boolean`

Path-style addressing (`host/bucket/key`). Required by MinIO.

#### region?

> `optional` **region?**: `string`

#### requestChecksumCalculation?

> `optional` **requestChecksumCalculation?**: `"WHEN_SUPPORTED"` \| `"WHEN_REQUIRED"`

Passed through to the AWS SDK, and mirrors its own casing. Current
SDK versions default to `'WHEN_SUPPORTED'`, computing a CRC32
checksum on every PutObject, which some S3-compatible backends
reject. Set `'WHEN_REQUIRED'` if a backend rejects checksummed
writes.

#### supportsACL?

> `optional` **supportsACL?**: `boolean`

Whether the backend implements object ACLs. Leave unset for AWS S3.
Set `false` for backends without ACL support — flydrive then skips the
`x-amz-acl` header on every write. Cloudflare R2 requires `false`;
`driver: 'r2'` forces it for you.

#### visibility?

> `optional` **visibility?**: `"public"` \| `"private"`

***

### Type Literal

\{ `accountId`: `string`; `baseUrl?`: `string`; `bucket`: `string`; `credentials?`: [`S3Credentials`](/api/interfaces/S3Credentials/); `driver`: `"r2"`; `endpoint?`: `string`; `visibility?`: `"public"` \| `"private"`; \}

#### accountId

> **accountId**: `string`

Cloudflare account ID. Derives the S3 API endpoint.

#### baseUrl?

> `optional` **baseUrl?**: `string`

Public URL base — an `https://pub-….r2.dev` subdomain or a custom
domain. R2 has no object ACLs, so this is the *only* way to produce
working public URLs; a `.public()` collection on an r2 disk without
it throws when the MediaLibrary is constructed.

#### bucket

> **bucket**: `string`

#### credentials?

> `optional` **credentials?**: [`S3Credentials`](/api/interfaces/S3Credentials/)

Static R2 credentials. Omit to use the AWS SDK's default provider chain.

#### driver

> **driver**: `"r2"`

#### endpoint?

> `optional` **endpoint?**: `string`

Overrides the endpoint derived from `accountId`. Needed for R2's EU
jurisdiction, whose host differs from the default.

#### visibility?

> `optional` **visibility?**: `"public"` \| `"private"`

***

### Type Literal

\{ `baseUrl?`: `string`; `bucket`: `string`; `credentials?`: `Record`\<`string`, `unknown`\>; `driver`: `"gcs"`; `keyFilename?`: `string`; `projectId?`: `string`; `usingUniformAcl?`: `boolean`; `visibility?`: `"public"` \| `"private"`; \}
