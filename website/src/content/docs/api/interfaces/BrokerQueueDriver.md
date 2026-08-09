---
title: 'BrokerQueueDriver'
editUrl: false
---
# Interface: BrokerQueueDriver

Defined in: [packages/core/src/queue.ts:27](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L27)

Backed by an external broker. Consuming requires an explicit
`MediaLibrary.startWorker()` in a dedicated process.

## Extends

- [`QueueDriver`](/api/interfaces/QueueDriver/)

## Methods

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [packages/core/src/queue.ts:12](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L12)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`QueueDriver`](/api/interfaces/QueueDriver/).[`close`](/api/interfaces/QueueDriver/#close)

***

### enqueue()

> **enqueue**(`job`): `Promise`\<`void`\>

Defined in: [packages/core/src/queue.ts:11](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L11)

#### Parameters

##### job

[`ConversionJob`](/api/interfaces/ConversionJob/)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`QueueDriver`](/api/interfaces/QueueDriver/).[`enqueue`](/api/interfaces/QueueDriver/#enqueue)

***

### work()

> **work**(`processor`, `opts?`): `Promise`\<[`QueueWorker`](/api/interfaces/QueueWorker/)\>

Defined in: [packages/core/src/queue.ts:28](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L28)

#### Parameters

##### processor

[`ConversionProcessor`](/api/type-aliases/ConversionProcessor/)

##### opts?

[`WorkOptions`](/api/interfaces/WorkOptions/)

#### Returns

`Promise`\<[`QueueWorker`](/api/interfaces/QueueWorker/)\>
