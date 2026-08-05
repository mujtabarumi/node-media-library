---
title: 'MediaRepository'
editUrl: false
---
# Interface: MediaRepository

Defined in: [packages/core/src/repository.ts:8](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L8)

## Methods

### create()

> **create**(`data`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository.ts:9](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L9)

#### Parameters

##### data

[`NewMediaRecord`](/api/type-aliases/NewMediaRecord/)

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### delete()

> **delete**(`id`): `Promise`\<`void`\>

Defined in: [packages/core/src/repository.ts:14](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L14)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

***

### findById()

> **findById**(`id`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

Defined in: [packages/core/src/repository.ts:11](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L11)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

***

### findByUuid()

> **findByUuid**(`uuid`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

Defined in: [packages/core/src/repository.ts:12](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L12)

#### Parameters

##### uuid

`string`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

***

### findForModel()

> **findForModel**(`modelType`, `modelId`, `collection?`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)[]\>

Defined in: [packages/core/src/repository.ts:13](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L13)

#### Parameters

##### modelType

`string`

##### modelId

`string`

##### collection?

`string`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)[]\>

***

### iterateAll()

> **iterateAll**(`filter?`): `AsyncIterable`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository.ts:16](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L16)

#### Parameters

##### filter?

[`MediaFilter`](/api/interfaces/MediaFilter/)

#### Returns

`AsyncIterable`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### markConversionGenerated()

> **markConversionGenerated**(`id`, `name`, `generated`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository.ts:31](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L31)

Merges `{ [name]: generated }` into the record's `generatedConversions`
map. Unlike a read→`update()` round-trip in the caller, the read-merge-
write happens inside the repository, so the adapter can serialize it
where its backend allows (e.g. a single-threaded in-memory map, or
SQLite's single-writer model) — two concurrent calls for different names
are then guaranteed to both persist. Adapters whose backend cannot fully
serialize this read-merge-write (e.g. a read-committed SQL database
without row locks, where `$transaction`-wrapped read-then-write doesn't
block a concurrent transaction from reading the same pre-update row)
narrow the lost-update window but may not eliminate it — see the
adapter's own docs for its actual guarantee.

#### Parameters

##### id

`string`

##### name

`string`

##### generated

`boolean`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### mergeResponsiveImages()

> **mergeResponsiveImages**(`id`, `conversion`, `entry`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository.ts:33](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L33)

Same contract for `responsiveImages[conversion] = entry`.

#### Parameters

##### id

`string`

##### conversion

`string`

##### entry

[`JsonObject`](/api/type-aliases/JsonObject/)

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### ownerExists()

> **ownerExists**(`modelType`, `modelId`): `Promise`\<`boolean`\>

Defined in: [packages/core/src/repository.ts:17](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L17)

#### Parameters

##### modelType

`string`

##### modelId

`string`

#### Returns

`Promise`\<`boolean`\>

***

### removeCustomProperty()

> **removeCustomProperty**(`id`, `key`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository.ts:37](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L37)

Atomically remove a single custom property key, preserving sibling keys.

#### Parameters

##### id

`string`

##### key

`string`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### setCustomProperty()

> **setCustomProperty**(`id`, `key`, `value`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository.ts:35](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L35)

Atomically set a single custom property key, preserving sibling keys.

#### Parameters

##### id

`string`

##### key

`string`

##### value

`unknown`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### setOrder()

> **setOrder**(`ids`, `startAt?`): `Promise`\<`void`\>

Defined in: [packages/core/src/repository.ts:15](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L15)

#### Parameters

##### ids

`string`[]

##### startAt?

`number`

#### Returns

`Promise`\<`void`\>

***

### update()

> **update**(`id`, `patch`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository.ts:10](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository.ts#L10)

#### Parameters

##### id

`string`

##### patch

`Partial`\<`Omit`\<[`MediaRecord`](/api/interfaces/MediaRecord/), `"id"` \| `"createdAt"`\>\>

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>
