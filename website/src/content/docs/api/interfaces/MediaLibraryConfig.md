---
title: 'MediaLibraryConfig'
editUrl: false
---
# Interface: MediaLibraryConfig

Defined in: [packages/core/src/config.ts:20](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L20)

## Properties

### allowedExtensions?

> `optional` **allowedExtensions?**: `string`[]

Defined in: [packages/core/src/config.ts:28](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L28)

***

### disallowedExtensions?

> `optional` **disallowedExtensions?**: `string`[]

Defined in: [packages/core/src/config.ts:27](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L27)

Default DEFAULT_DISALLOWED_EXTENSIONS.

***

### fileNameSanitizer?

> `optional` **fileNameSanitizer?**: [`FileNameSanitizer`](/api/type-aliases/FileNameSanitizer/)

Defined in: [packages/core/src/config.ts:33](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L33)

***

### imageGenerators?

> `optional` **imageGenerators?**: [`ImageGenerator`](/api/interfaces/ImageGenerator/)[]

Defined in: [packages/core/src/config.ts:39](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L39)

Default `[sharpImageGenerator()]`.

***

### maxFileSize?

> `optional` **maxFileSize?**: `number`

Defined in: [packages/core/src/config.ts:25](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L25)

Default 10 * 1024 * 1024 (10 MiB).

***

### models

> **models**: `Record`\<`string`, \{ `collections?`: `Record`\<`string`, [`CollectionBuilder`](/api/classes/CollectionBuilder/)\>; \}\>

Defined in: [packages/core/src/config.ts:23](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L23)

***

### optimizers?

> `optional` **optimizers?**: [`ImageOptimizer`](/api/interfaces/ImageOptimizer/)[]

Defined in: [packages/core/src/config.ts:45](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L45)

Default `[]`.

***

### pathGenerator?

> `optional` **pathGenerator?**: [`PathGenerator`](/api/interfaces/PathGenerator/)

Defined in: [packages/core/src/config.ts:34](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L34)

***

### queue?

> `optional` **queue?**: [`QueueDriver`](/api/interfaces/QueueDriver/)

Defined in: [packages/core/src/config.ts:37](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L37)

Default `syncDriver()` (conversions run inline, synchronously).

***

### repository

> **repository**: [`MediaRepository`](/api/interfaces/MediaRepository/)

Defined in: [packages/core/src/config.ts:21](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L21)

***

### responsivePlaceholders?

> `optional` **responsivePlaceholders?**: `boolean`

Defined in: [packages/core/src/config.ts:43](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L43)

Generate LQIP placeholders for responsive variants. Default true.

***

### responsiveWidthCalculator?

> `optional` **responsiveWidthCalculator?**: [`WidthCalculator`](/api/interfaces/WidthCalculator/)

Defined in: [packages/core/src/config.ts:41](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L41)

Default `new FileSizeOptimizedWidthCalculator()`.

***

### signedUrlExpiresIn?

> `optional` **signedUrlExpiresIn?**: `string` \| `number`

Defined in: [packages/core/src/config.ts:32](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L32)

Default '30 mins'.

***

### storage?

> `optional` **storage?**: [`StorageConfig`](/api/interfaces/StorageConfig/)

Defined in: [packages/core/src/config.ts:22](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L22)

***

### urlGenerator?

> `optional` **urlGenerator?**: [`UrlGenerator`](/api/interfaces/UrlGenerator/)

Defined in: [packages/core/src/config.ts:35](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L35)

***

### versionUrls?

> `optional` **versionUrls?**: `boolean`

Defined in: [packages/core/src/config.ts:30](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/config.ts#L30)

Default false.
