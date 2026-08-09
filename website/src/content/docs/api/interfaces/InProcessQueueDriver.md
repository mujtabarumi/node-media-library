---
title: 'InProcessQueueDriver'
editUrl: false
---
# Interface: InProcessQueueDriver

Defined in: [packages/core/src/queue.ts:19](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L19)

Consumes in the same process that produces. Core attaches its processor at
construction — there is no separate worker process.

## Extends

- [`QueueDriver`](/api/interfaces/QueueDriver/)

## Methods

### attach()

> **attach**(`processor`): `void`

Defined in: [packages/core/src/queue.ts:20](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L20)

#### Parameters

##### processor

[`ConversionProcessor`](/api/type-aliases/ConversionProcessor/)

#### Returns

`void`

***

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
