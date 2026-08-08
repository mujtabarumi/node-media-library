---
title: 'QueueDriver'
editUrl: false
---
# Interface: QueueDriver

Defined in: [packages/core/src/queue.ts:10](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L10)

## Extended by

- [`InProcessQueueDriver`](/api/interfaces/InProcessQueueDriver/)
- [`BrokerQueueDriver`](/api/interfaces/BrokerQueueDriver/)

## Methods

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [packages/core/src/queue.ts:12](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L12)

#### Returns

`Promise`\<`void`\>

***

### enqueue()

> **enqueue**(`job`): `Promise`\<`void`\>

Defined in: [packages/core/src/queue.ts:11](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L11)

#### Parameters

##### job

[`ConversionJob`](/api/interfaces/ConversionJob/)

#### Returns

`Promise`\<`void`\>
