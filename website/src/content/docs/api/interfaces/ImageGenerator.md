---
title: 'ImageGenerator'
editUrl: false
---
# Interface: ImageGenerator

Defined in: [packages/core/src/conversions/image-generator.ts:12](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/conversions/image-generator.ts#L12)

## Methods

### supports()

> **supports**(`mimeType`): `boolean`

Defined in: [packages/core/src/conversions/image-generator.ts:13](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/conversions/image-generator.ts#L13)

#### Parameters

##### mimeType

`string` \| `null`

#### Returns

`boolean`

***

### toImage()

> **toImage**(`input`, `def`): `Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

Defined in: [packages/core/src/conversions/image-generator.ts:19](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/conversions/image-generator.ts#L19)

Applies `def` to the source and returns the derived raster. `input` is
always the full source file's bytes; generators needing a real file
(pdf/video binaries) write a temp file internally.

#### Parameters

##### input

`Buffer`

##### def

[`ConversionDefinition`](/api/interfaces/ConversionDefinition/)

#### Returns

`Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

***

### toSourceImage()?

> `optional` **toSourceImage**(`input`): `Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

Defined in: [packages/core/src/conversions/image-generator.ts:25](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/conversions/image-generator.ts#L25)

Optional: renders a plain, conversion-free raster of the source (e.g.
PDF page 1, video frame at 0s) for use as the original-responsive
source. Absent means `input` is already a sharp-readable image.

#### Parameters

##### input

`Buffer`

#### Returns

`Promise`\<`Buffer`\<`ArrayBufferLike`\>\>
