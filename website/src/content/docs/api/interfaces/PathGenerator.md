---
title: 'PathGenerator'
editUrl: false
---
# Interface: PathGenerator

Defined in: [packages/core/src/storage/path-generator.ts:3](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/path-generator.ts#L3)

## Methods

### conversionsPath()

> **conversionsPath**(`media`): `string`

Defined in: [packages/core/src/storage/path-generator.ts:7](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/path-generator.ts#L7)

Directory holding derived conversion files.

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

#### Returns

`string`

***

### directory()

> **directory**(`media`): `string`

Defined in: [packages/core/src/storage/path-generator.ts:11](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/path-generator.ts#L11)

Root directory for this media item (used e.g. for delete).

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

#### Returns

`string`

***

### path()

> **path**(`media`): `string`

Defined in: [packages/core/src/storage/path-generator.ts:5](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/path-generator.ts#L5)

Path to the original file.

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

#### Returns

`string`

***

### responsivePath()

> **responsivePath**(`media`): `string`

Defined in: [packages/core/src/storage/path-generator.ts:9](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/path-generator.ts#L9)

Directory holding responsive image variants.

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

#### Returns

`string`
