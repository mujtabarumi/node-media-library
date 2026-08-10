---
title: 'S3Credentials'
editUrl: false
---
# Interface: S3Credentials

Defined in: [packages/core/src/storage/resolve.ts:24](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/resolve.ts#L24)

Static S3 credentials. Declared structurally rather than imported from
`@aws-sdk/client-s3`, which is an *optional* peer — a type import would
break `tsc` for every fs/gcs consumer who never installed the AWS SDK.
The shape is structurally compatible with the SDK's own credentials
object, so it passes through unchanged.

## Properties

### accessKeyId

> **accessKeyId**: `string`

Defined in: [packages/core/src/storage/resolve.ts:25](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/resolve.ts#L25)

***

### secretAccessKey

> **secretAccessKey**: `string`

Defined in: [packages/core/src/storage/resolve.ts:26](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/resolve.ts#L26)

***

### sessionToken?

> `optional` **sessionToken?**: `string`

Defined in: [packages/core/src/storage/resolve.ts:27](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/resolve.ts#L27)
