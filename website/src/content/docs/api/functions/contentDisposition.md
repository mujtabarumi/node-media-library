---
title: 'contentDisposition'
editUrl: false
---
# Function: contentDisposition()

> **contentDisposition**(`kind`, `fileName`): `string`

Defined in: [packages/core/src/downloads/response.ts:17](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/downloads/response.ts#L17)

`Content-Disposition` value with an ASCII-sanitized filename (spec §11):
printable ASCII only, `"` and `` replaced too, so the header never needs
escaping or RFC 5987 encoding.

## Parameters

### kind

`"attachment"` \| `"inline"`

### fileName

`string`

## Returns

`string`
