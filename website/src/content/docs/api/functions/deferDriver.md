---
title: 'deferDriver'
editUrl: false
---
# Function: deferDriver()

> **deferDriver**(): [`InProcessQueueDriver`](/api/interfaces/InProcessQueueDriver/)

Defined in: [packages/core/src/queue.ts:85](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L85)

Deferred in-process driver: `enqueue` resolves immediately and the processor
runs on a later tick via `setImmediate`. Processor errors are caught and
logged (never surfaced as unhandled rejections) — the engine is responsible
for emitting `conversion:failed` itself.

`close()` waits for every already-scheduled callback to settle before
resolving, so a caller that awaits it observes no further processor side
effects.

## Returns

[`InProcessQueueDriver`](/api/interfaces/InProcessQueueDriver/)
