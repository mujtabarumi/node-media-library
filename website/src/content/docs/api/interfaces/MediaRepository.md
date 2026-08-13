---
title: 'MediaRepository'
editUrl: false
---
# Interface: MediaRepository

Defined in: [packages/core/src/repository.ts:19](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L19)

## Methods

### create()

> **create**(`data`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository.ts:20](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L20)

#### Parameters

##### data

[`NewMediaRecord`](/api/type-aliases/NewMediaRecord/)

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### delete()

> **delete**(`id`): `Promise`\<`void`\>

Defined in: [packages/core/src/repository.ts:25](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L25)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

***

### findById()

> **findById**(`id`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

Defined in: [packages/core/src/repository.ts:22](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L22)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

***

### findByUuid()

> **findByUuid**(`uuid`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

Defined in: [packages/core/src/repository.ts:23](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L23)

#### Parameters

##### uuid

`string`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

***

### findForModel()

> **findForModel**(`modelType`, `modelId`, `collection?`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)[]\>

Defined in: [packages/core/src/repository.ts:24](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L24)

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

Defined in: [packages/core/src/repository.ts:27](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L27)

#### Parameters

##### filter?

[`MediaFilter`](/api/interfaces/MediaFilter/)

#### Returns

`AsyncIterable`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### markConversionGenerated()

> **markConversionGenerated**(`id`, `name`, `generated`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository.ts:42](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L42)

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

Defined in: [packages/core/src/repository.ts:44](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L44)

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

Defined in: [packages/core/src/repository.ts:28](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L28)

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

Defined in: [packages/core/src/repository.ts:48](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L48)

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

Defined in: [packages/core/src/repository.ts:46](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L46)

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

Defined in: [packages/core/src/repository.ts:26](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L26)

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

Defined in: [packages/core/src/repository.ts:21](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L21)

#### Parameters

##### id

`string`

##### patch

`Partial`\<`Omit`\<[`MediaRecord`](/api/interfaces/MediaRecord/), `"id"` \| `"createdAt"`\>\>

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>
