---
title: 'ResolvedStorage'
editUrl: false
---
# Interface: ResolvedStorage

Defined in: [packages/core/src/storage/resolve.ts:103](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/resolve.ts#L103)

The storage layer a `MediaLibrary` resolved from its config. Public because
`MediaLibrary.storage` returns it — typed code against that getter needs the
name. Constructing one is not part of the public surface; `resolveStorage`
stays internal.

## Properties

### defaultDisk

> **defaultDisk**: `string`

Defined in: [packages/core/src/storage/resolve.ts:104](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/resolve.ts#L104)

***

### prefix

> **prefix**: `string`

Defined in: [packages/core/src/storage/resolve.ts:105](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/resolve.ts#L105)

## Methods

### disk()

> **disk**(`name?`): `Promise`\<`Disk`\>

Defined in: [packages/core/src/storage/resolve.ts:107](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/resolve.ts#L107)

Lazily creates (and memoizes) the flydrive Disk for the named disk.

#### Parameters

##### name?

`string`

#### Returns

`Promise`\<`Disk`\>

***

### diskConfig()

> **diskConfig**(`name?`): [`DiskConfig`](/api/type-aliases/DiskConfig/)

Defined in: [packages/core/src/storage/resolve.ts:108](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/resolve.ts#L108)

#### Parameters

##### name?

`string`

#### Returns

[`DiskConfig`](/api/type-aliases/DiskConfig/)
