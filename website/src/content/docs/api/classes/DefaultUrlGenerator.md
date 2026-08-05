---
title: 'DefaultUrlGenerator'
editUrl: false
---
# Class: DefaultUrlGenerator

Defined in: [packages/core/src/storage/url-generator.ts:49](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/url-generator.ts#L49)

## Implements

- [`UrlGenerator`](/api/interfaces/UrlGenerator/)

## Constructors

### Constructor

> **new DefaultUrlGenerator**(`storage`, `pathGen`, `opts?`): `DefaultUrlGenerator`

Defined in: [packages/core/src/storage/url-generator.ts:50](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/url-generator.ts#L50)

#### Parameters

##### storage

`ResolvedStorage`

##### pathGen

[`PathGenerator`](/api/interfaces/PathGenerator/)

##### opts?

[`UrlGeneratorOptions`](/api/interfaces/UrlGeneratorOptions/) = `{}`

#### Returns

`DefaultUrlGenerator`

## Methods

### responsiveSignedUrl()

> **responsiveSignedUrl**(`media`, `fileName`, `opts?`): `Promise`\<`string`\>

Defined in: [packages/core/src/storage/url-generator.ts:164](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/url-generator.ts#L164)

Signed URL for a responsive variant file — the private-disk counterpart
to `responsiveUrl`. Optional for the same reason: custom `UrlGenerator`
implementations that predate responsive images keep compiling, and
`MediaLibrary.responsiveUrls`/`srcset` (when called with `{ signed: true }`)
degrade gracefully to `[]`/`null` when it's absent.

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

##### fileName

`string`

##### opts?

[`SignedUrlOptions`](/api/interfaces/SignedUrlOptions/)

#### Returns

`Promise`\<`string`\>

#### Implementation of

[`UrlGenerator`](/api/interfaces/UrlGenerator/).[`responsiveSignedUrl`](/api/interfaces/UrlGenerator/#responsivesignedurl)

***

### responsiveUrl()

> **responsiveUrl**(`media`, `fileName`): `Promise`\<`string`\>

Defined in: [packages/core/src/storage/url-generator.ts:117](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/url-generator.ts#L117)

Public URL for a responsive variant file (as stored in
`ResponsiveImagesEntry.files[].fileName`). Optional so custom
`UrlGenerator` implementations that predate responsive images keep
compiling; library read methods (`responsiveUrls`/`srcset`) degrade
gracefully to `[]`/`null` when it's absent.

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

##### fileName

`string`

#### Returns

`Promise`\<`string`\>

#### Implementation of

[`UrlGenerator`](/api/interfaces/UrlGenerator/).[`responsiveUrl`](/api/interfaces/UrlGenerator/#responsiveurl)

***

### signedUrl()

> **signedUrl**(`media`, `conversionName?`, `opts?`): `Promise`\<`string`\>

Defined in: [packages/core/src/storage/url-generator.ts:155](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/url-generator.ts#L155)

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

##### conversionName?

`string`

##### opts?

[`SignedUrlOptions`](/api/interfaces/SignedUrlOptions/)

#### Returns

`Promise`\<`string`\>

#### Implementation of

[`UrlGenerator`](/api/interfaces/UrlGenerator/).[`signedUrl`](/api/interfaces/UrlGenerator/#signedurl)

***

### url()

> **url**(`media`, `conversionName?`): `Promise`\<`string`\>

Defined in: [packages/core/src/storage/url-generator.ts:88](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/url-generator.ts#L88)

Throws StorageError if the disk cannot build public URLs.

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

##### conversionName?

`string`

#### Returns

`Promise`\<`string`\>

#### Implementation of

[`UrlGenerator`](/api/interfaces/UrlGenerator/).[`url`](/api/interfaces/UrlGenerator/#url)
