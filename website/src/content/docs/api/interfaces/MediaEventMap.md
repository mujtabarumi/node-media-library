---
title: 'MediaEventMap'
editUrl: false
---
# Interface: MediaEventMap

Defined in: [packages/core/src/events.ts:7](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L7)

## Properties

### collection:cleared

> **collection:cleared**: `object`

Defined in: [packages/core/src/events.ts:11](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L11)

#### collection

> **collection**: `string`

#### modelId

> **modelId**: `string`

#### modelType

> **modelType**: `string`

***

### conversion:completed

> **conversion:completed**: `object`

Defined in: [packages/core/src/events.ts:15](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L15)

#### conversion

> **conversion**: `string`

#### media

> **media**: [`MediaRecord`](/api/interfaces/MediaRecord/)

***

### conversion:failed

> **conversion:failed**: `object`

Defined in: [packages/core/src/events.ts:16](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L16)

#### conversion

> **conversion**: `string`

#### error

> **error**: `unknown`

#### media

> **media**: [`MediaRecord`](/api/interfaces/MediaRecord/)

***

### conversion:started

> **conversion:started**: `object`

Defined in: [packages/core/src/events.ts:14](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L14)

#### conversion

> **conversion**: `string`

#### media

> **media**: [`MediaRecord`](/api/interfaces/MediaRecord/)

***

### media:added

> **media:added**: `object`

Defined in: [packages/core/src/events.ts:8](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L8)

#### media

> **media**: [`MediaRecord`](/api/interfaces/MediaRecord/)

***

### media:copied

> **media:copied**: `object`

Defined in: [packages/core/src/events.ts:12](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L12)

#### copy

> **copy**: [`MediaRecord`](/api/interfaces/MediaRecord/)

#### media

> **media**: [`MediaRecord`](/api/interfaces/MediaRecord/)

***

### media:deleted

> **media:deleted**: `object`

Defined in: [packages/core/src/events.ts:10](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L10)

#### media

> **media**: [`MediaRecord`](/api/interfaces/MediaRecord/)

***

### media:deleting

> **media:deleting**: `object`

Defined in: [packages/core/src/events.ts:9](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L9)

#### media

> **media**: [`MediaRecord`](/api/interfaces/MediaRecord/)

***

### media:moved

> **media:moved**: `object`

Defined in: [packages/core/src/events.ts:13](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L13)

#### media

> **media**: [`MediaRecord`](/api/interfaces/MediaRecord/)

#### moved

> **moved**: [`MediaRecord`](/api/interfaces/MediaRecord/)

***

### responsive:failed

> **responsive:failed**: `object`

Defined in: [packages/core/src/events.ts:18](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L18)

#### conversion

> **conversion**: `string`

#### error

> **error**: `unknown`

#### media

> **media**: [`MediaRecord`](/api/interfaces/MediaRecord/)

***

### responsive:generated

> **responsive:generated**: `object`

Defined in: [packages/core/src/events.ts:17](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/events.ts#L17)

#### conversion

> **conversion**: `string`

#### media

> **media**: [`MediaRecord`](/api/interfaces/MediaRecord/)
