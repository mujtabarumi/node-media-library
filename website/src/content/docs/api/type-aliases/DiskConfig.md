---
title: 'DiskConfig'
editUrl: false
---
# Type Alias: DiskConfig

> **DiskConfig** = \{ `baseUrl?`: `string`; `driver`: `"fs"`; `root`: `string`; `visibility?`: `"public"` \| `"private"`; \} \| \{ `baseUrl?`: `string`; `bucket`: `string`; `driver`: `"s3"`; `endpoint?`: `string`; `region?`: `string`; `visibility?`: `"public"` \| `"private"`; \} \| \{ `baseUrl?`: `string`; `bucket`: `string`; `credentials?`: `Record`\<`string`, `unknown`\>; `driver`: `"gcs"`; `keyFilename?`: `string`; `projectId?`: `string`; `usingUniformAcl?`: `boolean`; `visibility?`: `"public"` \| `"private"`; \}

Defined in: [packages/core/src/storage/resolve.ts:17](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/resolve.ts#L17)
