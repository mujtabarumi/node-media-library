---
title: 'ImageOptimizer'
editUrl: false
---
# Interface: ImageOptimizer

Defined in: [packages/core/src/conversions/optimizer.ts:11](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/optimizer.ts#L11)

## Properties

### name

> **name**: `string`

Defined in: [packages/core/src/conversions/optimizer.ts:12](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/optimizer.ts#L12)

## Methods

### optimize()

> **optimize**(`buffer`, `ctx`): `Promise`\<`Buffer`\<`ArrayBufferLike`\> \| `null`\>

Defined in: [packages/core/src/conversions/optimizer.ts:14](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/optimizer.ts#L14)

Return optimized bytes, or null to pass (unsupported format / binary missing).

#### Parameters

##### buffer

`Buffer`

##### ctx

[`OptimizeContext`](/api/interfaces/OptimizeContext/)

#### Returns

`Promise`\<`Buffer`\<`ArrayBufferLike`\> \| `null`\>
