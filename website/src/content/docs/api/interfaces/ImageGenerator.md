---
title: 'ImageGenerator'
editUrl: false
---
# Interface: ImageGenerator

Defined in: [packages/core/src/conversions/image-generator.ts:13](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/image-generator.ts#L13)

## Methods

### supports()

> **supports**(`mimeType`): `boolean`

Defined in: [packages/core/src/conversions/image-generator.ts:14](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/image-generator.ts#L14)

#### Parameters

##### mimeType

`string` \| `null`

#### Returns

`boolean`

***

### toImage()

> **toImage**(`input`, `def`): `Promise`\<`Buffer`\<`ArrayBufferLike`\>\>

Defined in: [packages/core/src/conversions/image-generator.ts:20](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/image-generator.ts#L20)

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

Defined in: [packages/core/src/conversions/image-generator.ts:26](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/image-generator.ts#L26)

Optional: renders a plain, conversion-free raster of the source (e.g.
PDF page 1, video frame at 0s) for use as the original-responsive
source. Absent means `input` is already a sharp-readable image.

#### Parameters

##### input

`Buffer`

#### Returns

`Promise`\<`Buffer`\<`ArrayBufferLike`\>\>
