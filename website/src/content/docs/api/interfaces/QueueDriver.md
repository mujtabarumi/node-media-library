---
title: 'QueueDriver'
editUrl: false
---
# Interface: QueueDriver

Defined in: [packages/core/src/queue.ts:10](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/queue.ts#L10)

## Methods

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [packages/core/src/queue.ts:13](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/queue.ts#L13)

#### Returns

`Promise`\<`void`\>

***

### enqueue()

> **enqueue**(`job`): `Promise`\<`void`\>

Defined in: [packages/core/src/queue.ts:11](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/queue.ts#L11)

#### Parameters

##### job

[`ConversionJob`](/api/interfaces/ConversionJob/)

#### Returns

`Promise`\<`void`\>

***

### registerProcessor()

> **registerProcessor**(`fn`): `void`

Defined in: [packages/core/src/queue.ts:12](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/queue.ts#L12)

#### Parameters

##### fn

[`ConversionProcessor`](/api/type-aliases/ConversionProcessor/)

#### Returns

`void`
