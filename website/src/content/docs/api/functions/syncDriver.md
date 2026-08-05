---
title: 'syncDriver'
editUrl: false
---
# Function: syncDriver()

> **syncDriver**(): [`QueueDriver`](/api/interfaces/QueueDriver/)

Defined in: [packages/core/src/queue.ts:20](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L20)

Synchronous queue driver: `enqueue` awaits the processor inline, so
processor errors propagate directly to the `enqueue` caller.

## Returns

[`QueueDriver`](/api/interfaces/QueueDriver/)
