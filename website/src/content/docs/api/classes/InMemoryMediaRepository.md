---
title: 'InMemoryMediaRepository'
editUrl: false
---
# Class: InMemoryMediaRepository

Defined in: [packages/core/src/repository/in-memory.ts:15](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L15)

## Implements

- [`MediaRepository`](/api/interfaces/MediaRepository/)

## Constructors

### Constructor

> **new InMemoryMediaRepository**(`opts?`): `InMemoryMediaRepository`

Defined in: [packages/core/src/repository/in-memory.ts:19](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L19)

#### Parameters

##### opts?

###### ownerExists?

(`type`, `id`) => `boolean`

#### Returns

`InMemoryMediaRepository`

## Methods

### create()

> **create**(`data`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository/in-memory.ts:23](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L23)

#### Parameters

##### data

[`NewMediaRecord`](/api/type-aliases/NewMediaRecord/)

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`create`](/api/interfaces/MediaRepository/#create)

***

### delete()

> **delete**(`id`): `Promise`\<`void`\>

Defined in: [packages/core/src/repository/in-memory.ts:79](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L79)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`delete`](/api/interfaces/MediaRepository/#delete)

***

### findById()

> **findById**(`id`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

Defined in: [packages/core/src/repository/in-memory.ts:55](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L55)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`findById`](/api/interfaces/MediaRepository/#findbyid)

***

### findByUuid()

> **findByUuid**(`uuid`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

Defined in: [packages/core/src/repository/in-memory.ts:59](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L59)

#### Parameters

##### uuid

`string`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`findByUuid`](/api/interfaces/MediaRepository/#findbyuuid)

***

### findForModel()

> **findForModel**(`modelType`, `modelId`, `collection?`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)[]\>

Defined in: [packages/core/src/repository/in-memory.ts:66](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L66)

#### Parameters

##### modelType

`string`

##### modelId

`string`

##### collection?

`string`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)[]\>

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`findForModel`](/api/interfaces/MediaRepository/#findformodel)

***

### iterateAll()

> **iterateAll**(`filter?`): `AsyncIterable`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository/in-memory.ts:93](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L93)

#### Parameters

##### filter?

[`MediaFilter`](/api/interfaces/MediaFilter/)

#### Returns

`AsyncIterable`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`iterateAll`](/api/interfaces/MediaRepository/#iterateall)

***

### markConversionGenerated()

> **markConversionGenerated**(`id`, `name`, `generated`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository/in-memory.ts:111](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L111)

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

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`markConversionGenerated`](/api/interfaces/MediaRepository/#markconversiongenerated)

***

### mergeResponsiveImages()

> **mergeResponsiveImages**(`id`, `conversion`, `entry`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository/in-memory.ts:129](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L129)

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

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`mergeResponsiveImages`](/api/interfaces/MediaRepository/#mergeresponsiveimages)

***

### ownerExists()

> **ownerExists**(`modelType`, `modelId`): `Promise`\<`boolean`\>

Defined in: [packages/core/src/repository/in-memory.ts:107](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L107)

#### Parameters

##### modelType

`string`

##### modelId

`string`

#### Returns

`Promise`\<`boolean`\>

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`ownerExists`](/api/interfaces/MediaRepository/#ownerexists)

***

### removeCustomProperty()

> **removeCustomProperty**(`id`, `key`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository/in-memory.ts:161](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L161)

Atomically remove a single custom property key, preserving sibling keys.

#### Parameters

##### id

`string`

##### key

`string`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`removeCustomProperty`](/api/interfaces/MediaRepository/#removecustomproperty)

***

### setCustomProperty()

> **setCustomProperty**(`id`, `key`, `value`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository/in-memory.ts:147](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L147)

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

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`setCustomProperty`](/api/interfaces/MediaRepository/#setcustomproperty)

***

### setOrder()

> **setOrder**(`ids`, `startAt?`): `Promise`\<`void`\>

Defined in: [packages/core/src/repository/in-memory.ts:83](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L83)

#### Parameters

##### ids

`string`[]

##### startAt?

`number` = `1`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`setOrder`](/api/interfaces/MediaRepository/#setorder)

***

### update()

> **update**(`id`, `patch`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository/in-memory.ts:36](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/repository/in-memory.ts#L36)

#### Parameters

##### id

`string`

##### patch

`Partial`\<`Omit`\<[`MediaRecord`](/api/interfaces/MediaRecord/), `"id"` \| `"createdAt"`\>\>

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`update`](/api/interfaces/MediaRepository/#update)
