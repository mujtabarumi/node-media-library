---
title: 'ConversionBuilder'
editUrl: false
---
# Class: ConversionBuilder

Defined in: [packages/core/src/definitions/conversion.ts:19](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L19)

## Constructors

### Constructor

> **new ConversionBuilder**(): `ConversionBuilder`

Defined in: [packages/core/src/definitions/conversion.ts:22](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L22)

#### Returns

`ConversionBuilder`

## Methods

### autoOrient()

> **autoOrient**(`on?`): `this`

Defined in: [packages/core/src/definitions/conversion.ts:107](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L107)

#### Parameters

##### on?

`boolean` = `true`

#### Returns

`this`

***

### blur()

> **blur**(`sigma`): `this`

Defined in: [packages/core/src/definitions/conversion.ts:97](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L97)

#### Parameters

##### sigma

`number`

#### Returns

`this`

***

### fit()

> **fit**(`f`): `this`

Defined in: [packages/core/src/definitions/conversion.ts:52](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L52)

#### Parameters

##### f

`"cover"` \| `"contain"` \| `"fill"` \| `"inside"` \| `"outside"`

#### Returns

`this`

***

### format()

> **format**(`f`): `this`

Defined in: [packages/core/src/definitions/conversion.ts:57](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L57)

#### Parameters

##### f

`"jpeg"` \| `"png"` \| `"webp"` \| `"avif"`

#### Returns

`this`

***

### greyscale()

> **greyscale**(): `this`

Defined in: [packages/core/src/definitions/conversion.ts:102](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L102)

#### Returns

`this`

***

### height()

> **height**(`n`): `this`

Defined in: [packages/core/src/definitions/conversion.ts:47](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L47)

#### Parameters

##### n

`number`

#### Returns

`this`

***

### keepOriginalFormat()

> **keepOriginalFormat**(): `this`

Defined in: [packages/core/src/definitions/conversion.ts:112](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L112)

#### Returns

`this`

***

### nonQueued()

> **nonQueued**(): `this`

Defined in: [packages/core/src/definitions/conversion.ts:72](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L72)

#### Returns

`this`

***

### pdfPageNumber()

> **pdfPageNumber**(`n`): `this`

Defined in: [packages/core/src/definitions/conversion.ts:117](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L117)

#### Parameters

##### n

`number`

#### Returns

`this`

***

### performOnCollections()

> **performOnCollections**(...`names`): `this`

Defined in: [packages/core/src/definitions/conversion.ts:77](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L77)

#### Parameters

##### names

...`string`[]

#### Returns

`this`

***

### position()

> **position**(`p`): `this`

Defined in: [packages/core/src/definitions/conversion.ts:87](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L87)

#### Parameters

##### p

`string`

#### Returns

`this`

***

### quality()

> **quality**(`n`): `this`

Defined in: [packages/core/src/definitions/conversion.ts:62](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L62)

#### Parameters

##### n

`number`

#### Returns

`this`

***

### queued()

> **queued**(): `this`

Defined in: [packages/core/src/definitions/conversion.ts:67](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L67)

#### Returns

`this`

***

### sharpen()

> **sharpen**(): `this`

Defined in: [packages/core/src/definitions/conversion.ts:92](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L92)

#### Returns

`this`

***

### toDefinition()

> **toDefinition**(): [`ConversionDefinition`](/api/interfaces/ConversionDefinition/)

Defined in: [packages/core/src/definitions/conversion.ts:127](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L127)

#### Returns

[`ConversionDefinition`](/api/interfaces/ConversionDefinition/)

***

### videoFrameAtSecond()

> **videoFrameAtSecond**(`s`): `this`

Defined in: [packages/core/src/definitions/conversion.ts:122](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L122)

#### Parameters

##### s

`number`

#### Returns

`this`

***

### width()

> **width**(`n`): `this`

Defined in: [packages/core/src/definitions/conversion.ts:42](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L42)

#### Parameters

##### n

`number`

#### Returns

`this`

***

### withResponsiveImages()

> **withResponsiveImages**(): `this`

Defined in: [packages/core/src/definitions/conversion.ts:82](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/definitions/conversion.ts#L82)

#### Returns

`this`
