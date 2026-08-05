---
title: 'DefaultPathGenerator'
editUrl: false
---
# Class: DefaultPathGenerator

Defined in: [packages/core/src/storage/path-generator.ts:14](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/path-generator.ts#L14)

## Implements

- [`PathGenerator`](/api/interfaces/PathGenerator/)

## Constructors

### Constructor

> **new DefaultPathGenerator**(`prefix?`): `DefaultPathGenerator`

Defined in: [packages/core/src/storage/path-generator.ts:15](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/path-generator.ts#L15)

#### Parameters

##### prefix?

`string`

#### Returns

`DefaultPathGenerator`

## Methods

### conversionsPath()

> **conversionsPath**(`media`): `string`

Defined in: [packages/core/src/storage/path-generator.ts:29](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/path-generator.ts#L29)

Directory holding derived conversion files.

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

#### Returns

`string`

#### Implementation of

[`PathGenerator`](/api/interfaces/PathGenerator/).[`conversionsPath`](/api/interfaces/PathGenerator/#conversionspath)

***

### directory()

> **directory**(`media`): `string`

Defined in: [packages/core/src/storage/path-generator.ts:21](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/path-generator.ts#L21)

Root directory for this media item (used e.g. for delete).

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

#### Returns

`string`

#### Implementation of

[`PathGenerator`](/api/interfaces/PathGenerator/).[`directory`](/api/interfaces/PathGenerator/#directory)

***

### path()

> **path**(`media`): `string`

Defined in: [packages/core/src/storage/path-generator.ts:25](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/path-generator.ts#L25)

Path to the original file.

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

#### Returns

`string`

#### Implementation of

[`PathGenerator`](/api/interfaces/PathGenerator/).[`path`](/api/interfaces/PathGenerator/#path)

***

### responsivePath()

> **responsivePath**(`media`): `string`

Defined in: [packages/core/src/storage/path-generator.ts:33](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/path-generator.ts#L33)

Directory holding responsive image variants.

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

#### Returns

`string`

#### Implementation of

[`PathGenerator`](/api/interfaces/PathGenerator/).[`responsivePath`](/api/interfaces/PathGenerator/#responsivepath)
