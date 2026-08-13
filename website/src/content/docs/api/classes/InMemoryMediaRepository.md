---
title: 'InMemoryMediaRepository'
editUrl: false
---
# Class: InMemoryMediaRepository

Defined in: [packages/core/src/repository/in-memory.ts:16](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L16)

## Implements

- [`MediaRepository`](/api/interfaces/MediaRepository/)

## Constructors

### Constructor

> **new InMemoryMediaRepository**(`opts?`): `InMemoryMediaRepository`

Defined in: [packages/core/src/repository/in-memory.ts:20](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L20)

#### Parameters

##### opts?

###### ownerExists?

(`type`, `id`) => `boolean`

#### Returns

`InMemoryMediaRepository`

## Methods

### create()

> **create**(`data`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/repository/in-memory.ts:24](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L24)

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

Defined in: [packages/core/src/repository/in-memory.ts:80](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L80)

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

Defined in: [packages/core/src/repository/in-memory.ts:56](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L56)

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

Defined in: [packages/core/src/repository/in-memory.ts:60](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L60)

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

Defined in: [packages/core/src/repository/in-memory.ts:67](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L67)

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

Defined in: [packages/core/src/repository/in-memory.ts:94](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L94)

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

Defined in: [packages/core/src/repository/in-memory.ts:107](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L107)

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

Defined in: [packages/core/src/repository/in-memory.ts:125](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L125)

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

Defined in: [packages/core/src/repository/in-memory.ts:103](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L103)

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

Defined in: [packages/core/src/repository/in-memory.ts:157](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L157)

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

Defined in: [packages/core/src/repository/in-memory.ts:143](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L143)

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

Defined in: [packages/core/src/repository/in-memory.ts:84](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L84)

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

Defined in: [packages/core/src/repository/in-memory.ts:37](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/in-memory.ts#L37)

#### Parameters

##### id

`string`

##### patch

`Partial`\<`Omit`\<[`MediaRecord`](/api/interfaces/MediaRecord/), `"id"` \| `"createdAt"`\>\>

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

#### Implementation of

[`MediaRepository`](/api/interfaces/MediaRepository/).[`update`](/api/interfaces/MediaRepository/#update)
