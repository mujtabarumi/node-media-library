---
title: 'syncDriver'
editUrl: false
---
# Function: syncDriver()

> **syncDriver**(): [`QueueDriver`](/api/interfaces/QueueDriver/)

Defined in: [packages/core/src/queue.ts:20](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/queue.ts#L20)

Synchronous queue driver: `enqueue` awaits the processor inline, so
processor errors propagate directly to the `enqueue` caller.

## Returns

[`QueueDriver`](/api/interfaces/QueueDriver/)
