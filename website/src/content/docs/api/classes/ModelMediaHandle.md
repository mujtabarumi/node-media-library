---
title: 'ModelMediaHandle'
editUrl: false
---
# Class: ModelMediaHandle

Defined in: [packages/core/src/handle.ts:39](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L39)

Handle bound to a single (modelType, modelId) pair, scoped to operate on
that model's media.

## Constructors

### Constructor

> **new ModelMediaHandle**(`modelType`, `modelId`, `library`): `ModelMediaHandle`

Defined in: [packages/core/src/handle.ts:40](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L40)

#### Parameters

##### modelType

`string`

##### modelId

`string`

##### library

[`MediaLibrary`](/api/classes/MediaLibrary/)

#### Returns

`ModelMediaHandle`

## Properties

### modelId

> `readonly` **modelId**: `string`

Defined in: [packages/core/src/handle.ts:42](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L42)

***

### modelType

> `readonly` **modelType**: `string`

Defined in: [packages/core/src/handle.ts:41](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L41)

## Methods

### add()

> **add**(`source`): [`FileAdder`](/api/classes/FileAdder/)

Defined in: [packages/core/src/handle.ts:47](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L47)

Returns a `FileAdder` builder; call `.toCollection()` to run the pipeline.

#### Parameters

##### source

[`MediaSource`](/api/type-aliases/MediaSource/)

#### Returns

[`FileAdder`](/api/classes/FileAdder/)

***

### availableUrl()

> **availableUrl**(`collection`, `conversionNames`): `Promise`\<`string` \| `null`\>

Defined in: [packages/core/src/handle.ts:121](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L121)

Returns the URL for the first name in `conversionNames` whose conversion
has actually been generated for the collection's first media item, or
the original file's URL if none have. All conversions currently report
`false` until Plan 3 wires up real generation.

#### Parameters

##### collection

`string`

##### conversionNames

`string`[]

#### Returns

`Promise`\<`string` \| `null`\>

***

### clear()

> **clear**(`collection?`): `Promise`\<`void`\>

Defined in: [packages/core/src/handle.ts:146](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L146)

Deletes every record in `collection` (or all collections) and emits `collection:cleared`.

#### Parameters

##### collection?

`string`

#### Returns

`Promise`\<`void`\>

***

### delete()

> **delete**(`mediaId`): `Promise`\<`void`\>

Defined in: [packages/core/src/handle.ts:150](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L150)

#### Parameters

##### mediaId

`string`

#### Returns

`Promise`\<`void`\>

***

### first()

> **first**(`collection?`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

Defined in: [packages/core/src/handle.ts:63](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L63)

#### Parameters

##### collection?

`string`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/) \| `null`\>

***

### firstSignedUrl()

> **firstSignedUrl**(`collection?`, `conversionName?`, `opts?`): `Promise`\<`string` \| `null`\>

Defined in: [packages/core/src/handle.ts:99](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L99)

#### Parameters

##### collection?

`string`

##### conversionName?

`string`

##### opts?

[`SignedUrlOptions`](/api/interfaces/SignedUrlOptions/)

#### Returns

`Promise`\<`string` \| `null`\>

***

### firstUrl()

> **firstUrl**(`collection?`, `conversionName?`): `Promise`\<`string` \| `null`\>

Defined in: [packages/core/src/handle.ts:87](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L87)

Returns the URL of the first media item in `collection`, or the
collection's registered fallback URL (if any) when it's empty, or
`null` when there's no media and no fallback configured.

#### Parameters

##### collection?

`string`

##### conversionName?

`string`

#### Returns

`Promise`\<`string` \| `null`\>

***

### getAll()

> **getAll**(`collection?`, `filter?`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)[]\>

Defined in: [packages/core/src/handle.ts:57](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L57)

Returns media across the model's collections. `collection` undefined or
`'*'` means "all collections"; otherwise only that collection's media is
returned. `filter` further narrows the result: an object requires every
key to deep-equal `customProperties[key]`, a function is a predicate.

#### Parameters

##### collection?

`string`

##### filter?

[`MediaQueryFilter`](/api/type-aliases/MediaQueryFilter/)

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)[]\>

***

### reorder()

> **reorder**(`ids`): `Promise`\<`void`\>

Defined in: [packages/core/src/handle.ts:138](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/handle.ts#L138)

Reorders this handle's media. `ids` is filtered down to records that
actually belong to (modelType, modelId) — preserving the caller's
relative order — so a foreign media id slipped into the list can't
renumber another model's media.

#### Parameters

##### ids

`string`[]

#### Returns

`Promise`\<`void`\>
