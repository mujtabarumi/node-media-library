---
title: 'TypedEmitter\<T\>'
editUrl: false
---
# Class: TypedEmitter\<T\>

Defined in: [packages/core/src/events.ts:26](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L26)

## Type Parameters

### T

`T` *extends* `object`

## Constructors

### Constructor

> **new TypedEmitter**\<`T`\>(): `TypedEmitter`\<`T`\>

#### Returns

`TypedEmitter`\<`T`\>

## Methods

### emit()

> **emit**\<`K`\>(`event`, `payload`): `void`

Defined in: [packages/core/src/events.ts:37](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L37)

#### Type Parameters

##### K

`K` *extends* `string` \| `number` \| `symbol`

#### Parameters

##### event

`K`

##### payload

`T`\[`K`\]

#### Returns

`void`

***

### on()

> **on**\<`K`\>(`event`, `fn`): () => `void`

Defined in: [packages/core/src/events.ts:29](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L29)

#### Type Parameters

##### K

`K` *extends* `string` \| `number` \| `symbol`

#### Parameters

##### event

`K`

##### fn

(`payload`) => `void`

#### Returns

() => `void`
