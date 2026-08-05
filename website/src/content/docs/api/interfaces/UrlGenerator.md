---
title: 'UrlGenerator'
editUrl: false
---
# Interface: UrlGenerator

Defined in: [packages/core/src/storage/url-generator.ts:10](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/url-generator.ts#L10)

## Methods

### responsiveSignedUrl()?

> `optional` **responsiveSignedUrl**(`media`, `fileName`, `opts?`): `Promise`\<`string`\>

Defined in: [packages/core/src/storage/url-generator.ts:29](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/url-generator.ts#L29)

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

***

### responsiveUrl()?

> `optional` **responsiveUrl**(`media`, `fileName`): `Promise`\<`string`\>

Defined in: [packages/core/src/storage/url-generator.ts:21](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/url-generator.ts#L21)

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

***

### signedUrl()

> **signedUrl**(`media`, `conversionName?`, `opts?`): `Promise`\<`string`\>

Defined in: [packages/core/src/storage/url-generator.ts:13](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/url-generator.ts#L13)

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

##### conversionName?

`string`

##### opts?

[`SignedUrlOptions`](/api/interfaces/SignedUrlOptions/)

#### Returns

`Promise`\<`string`\>

***

### url()

> **url**(`media`, `conversionName?`): `Promise`\<`string`\>

Defined in: [packages/core/src/storage/url-generator.ts:12](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/storage/url-generator.ts#L12)

Throws StorageError if the disk cannot build public URLs.

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

##### conversionName?

`string`

#### Returns

`Promise`\<`string`\>
