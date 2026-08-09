---
title: 'QueueWorker'
editUrl: false
---
# Interface: QueueWorker

Defined in: [packages/core/src/queue.ts:31](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L31)

## Methods

### close()

> **close**(`opts?`): `Promise`\<`void`\>

Defined in: [packages/core/src/queue.ts:33](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/queue.ts#L33)

Stops consuming. Waits for in-flight jobs to settle unless `force`.

#### Parameters

##### opts?

###### force?

`boolean`

#### Returns

`Promise`\<`void`\>
