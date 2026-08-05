---
title: 'UrlGeneratorOptions'
editUrl: false
---
# Interface: UrlGeneratorOptions

Defined in: [packages/core/src/storage/url-generator.ts:36](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/url-generator.ts#L36)

## Properties

### conversionFileNameFor?

> `optional` **conversionFileNameFor?**: (`media`, `name`) => `string` \| `null`

Defined in: [packages/core/src/storage/url-generator.ts:46](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/url-generator.ts#L46)

Resolves the on-disk filename for `name`'s conversion of `media`, or
`null` when that conversion isn't defined/applicable. Optional so
existing callers (and Plan 1's generators.test.ts) that construct
`DefaultUrlGenerator` directly, without this dep, keep the original
"conversionName is a no-op" behavior.

#### Parameters

##### media

[`MediaRecord`](/api/interfaces/MediaRecord/)

##### name

`string`

#### Returns

`string` \| `null`

***

### signedUrlExpiresIn?

> `optional` **signedUrlExpiresIn?**: `string` \| `number`

Defined in: [packages/core/src/storage/url-generator.ts:38](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/url-generator.ts#L38)

***

### versionUrls?

> `optional` **versionUrls?**: `boolean`

Defined in: [packages/core/src/storage/url-generator.ts:37](https://github.com/mujtabarumi/node-media-library/blob/219751fb46b66dda5dbffa5c473c562b84c863e3/packages/core/src/storage/url-generator.ts#L37)
