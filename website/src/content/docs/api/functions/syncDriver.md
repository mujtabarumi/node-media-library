---
title: 'syncDriver'
editUrl: false
---
# Function: syncDriver()

> **syncDriver**(): [`InProcessQueueDriver`](/api/interfaces/InProcessQueueDriver/)

Defined in: [packages/core/src/queue.ts:48](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L48)

Synchronous in-process driver: `enqueue` awaits the processor inline, so
processor errors propagate directly to the `enqueue` caller.

## Returns

[`InProcessQueueDriver`](/api/interfaces/InProcessQueueDriver/)
