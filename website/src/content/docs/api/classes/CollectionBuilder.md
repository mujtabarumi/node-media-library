---
title: 'CollectionBuilder'
editUrl: false
---
# Class: CollectionBuilder

Defined in: [packages/core/src/definitions/collection.ts:49](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L49)

## Constructors

### Constructor

> **new CollectionBuilder**(): `CollectionBuilder`

Defined in: [packages/core/src/definitions/collection.ts:52](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L52)

#### Returns

`CollectionBuilder`

## Methods

### acceptsFile()

> **acceptsFile**(`fn`): `this`

Defined in: [packages/core/src/definitions/collection.ts:88](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L88)

#### Parameters

##### fn

(`file`) => `boolean`

#### Returns

`this`

***

### acceptsMimeTypes()

> **acceptsMimeTypes**(`types`): `this`

Defined in: [packages/core/src/definitions/collection.ts:83](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L83)

#### Parameters

##### types

`string`[]

#### Returns

`this`

***

### conversions()

> **conversions**(`record`): `this`

Defined in: [packages/core/src/definitions/collection.ts:113](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L113)

#### Parameters

##### record

`Record`\<`string`, [`ConversionBuilder`](/api/classes/ConversionBuilder/)\>

#### Returns

`this`

***

### fallbackUrl()

> **fallbackUrl**(`url`, `conversionName?`): `this`

Defined in: [packages/core/src/definitions/collection.ts:108](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L108)

#### Parameters

##### url

`string`

##### conversionName?

`string` = `''`

#### Returns

`this`

***

### onlyKeepLatest()

> **onlyKeepLatest**(`n`): `this`

Defined in: [packages/core/src/definitions/collection.ts:75](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L75)

#### Parameters

##### n

`number`

#### Returns

`this`

***

### public()

> **public**(): `this`

Defined in: [packages/core/src/definitions/collection.ts:103](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L103)

#### Returns

`this`

***

### singleFile()

> **singleFile**(): `this`

Defined in: [packages/core/src/definitions/collection.ts:67](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L67)

#### Returns

`this`

***

### storeConversionsOnDisk()

> **storeConversionsOnDisk**(`name`): `this`

Defined in: [packages/core/src/definitions/collection.ts:98](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L98)

#### Parameters

##### name

`string`

#### Returns

`this`

***

### toDefinition()

> **toDefinition**(): [`CollectionDefinition`](/api/interfaces/CollectionDefinition/)

Defined in: [packages/core/src/definitions/collection.ts:133](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L133)

#### Returns

[`CollectionDefinition`](/api/interfaces/CollectionDefinition/)

***

### useDisk()

> **useDisk**(`name`): `this`

Defined in: [packages/core/src/definitions/collection.ts:93](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L93)

#### Parameters

##### name

`string`

#### Returns

`this`

***

### withResponsiveImages()

> **withResponsiveImages**(): `this`

Defined in: [packages/core/src/definitions/collection.ts:128](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L128)

#### Returns

`this`
