---
title: 'MediaLibrary'
editUrl: false
---
# Class: MediaLibrary

Defined in: [packages/core/src/library.ts:49](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L49)

## Constructors

### Constructor

> **new MediaLibrary**(`config`): `MediaLibrary`

Defined in: [packages/core/src/library.ts:55](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L55)

#### Parameters

##### config

[`MediaLibraryConfig`](/api/interfaces/MediaLibraryConfig/)

#### Returns

`MediaLibrary`

## Properties

### events

> `readonly` **events**: [`TypedEmitter`](/api/classes/TypedEmitter/)\<[`MediaEventMap`](/api/interfaces/MediaEventMap/)\>

Defined in: [packages/core/src/library.ts:50](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L50)

## Accessors

### modelTypes

#### Get Signature

> **get** **modelTypes**(): `string`[]

Defined in: [packages/core/src/library.ts:253](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L253)

Registered model type names (e.g. `['User', 'Post']`).

##### Returns

`string`[]

## Methods

### clean()

> **clean**(`opts?`): `Promise`\<[`CleanResult`](/api/interfaces/CleanResult/)\>

Defined in: [packages/core/src/library.ts:665](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L665)

Offline maintenance operation: removes orphaned media (when
`opts.deleteOrphaned`), deletes derived files (conversions + responsive
variants) that no longer match the current collection/conversion
config, and prunes the corresponding stale `generatedConversions` /
`responsiveImages` keys. `opts.dryRun` counts everything a real run
would do without deleting or updating anything; `opts.rateLimit` spaces
out actual delete operations (files and orphaned-media deletes) to at
most that many per second — it gates storage deletes only, not the
repository update that prunes stale JSON keys.

A record is SKIPPED entirely for staleness checks (its files and JSON
are left untouched, counted in `result.skippedUnregistered`, and warned
about once via `console.warn`) when this config can't be trusted to
describe what's actually on disk for it: either its modelType/collection
isn't registered here (`getCollectionDefinition()`'s zero-conversion
fallback would otherwise make every existing conversion file/key look
stale), or it has generated conversions but no configured
`imageGenerator` supports its mimeType (which breaks
`effectiveFormat()`'s extension guess). `opts.deleteOrphaned` still
applies to these records — `repository.ownerExists` is independent of
config registration.

NOT safe to run concurrently with active conversion workers — a worker
writing a conversion's file/JSON for a record while `clean()` is
diffing that same record can result in either a spurious deletion or a
missed one. Run this offline (e.g. a scheduled job with no in-flight
uploads/conversions).

#### Parameters

##### opts?

[`CleanOptions`](/api/interfaces/CleanOptions/) = `{}`

#### Returns

`Promise`\<[`CleanResult`](/api/interfaces/CleanResult/)\>

***

### clearFor()

> **clearFor**(`modelType`, `modelId`, `collection?`): `Promise`\<`void`\>

Defined in: [packages/core/src/library.ts:440](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L440)

Deletes every record in `collection` (or all collections, when omitted
or `'*'`) for the given model and emits `collection:cleared`. This is
the shared implementation behind both `MediaLibrary.clearFor()` and
`ModelMediaHandle.clear()` — keeping one code path prevents the two
from drifting out of sync on the emitted event.

`'*'` is the documented "all collections" sentinel (mirroring
`ModelMediaHandle.getAll()`), so it must be normalized to `undefined`
before reaching `findForModel` — otherwise it's matched literally
against `collectionName` and matches nothing.

#### Parameters

##### modelType

`string`

##### modelId

`string` \| `number`

##### collection?

`string`

#### Returns

`Promise`\<`void`\>

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [packages/core/src/library.ts:130](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L130)

Releases the configured queue driver's resources.

#### Returns

`Promise`\<`void`\>

***

### copyMedia()

> **copyMedia**(`mediaOrId`, `toModelType`, `toModelId`, `opts?`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/library.ts:386](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L386)

Copy a media record to another model/collection by re-running the full
add pipeline on the target (Spatie semantics): the copy gets a new
id/uuid, the target collection's validation, disk config, and rules
(singleFile/keepLatest) apply, and conversions/responsive images are
regenerated rather than byte-copied. The source is never modified.

#### Parameters

##### mediaOrId

`string` \| [`MediaRecord`](/api/interfaces/MediaRecord/)

##### toModelType

`string`

##### toModelId

`string` \| `number`

##### opts?

[`CopyMediaOptions`](/api/interfaces/CopyMediaOptions/) = `{}`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### deleteMedia()

> **deleteMedia**(`mediaOrId`): `Promise`\<`void`\>

Defined in: [packages/core/src/library.ts:349](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L349)

#### Parameters

##### mediaOrId

`string` \| [`MediaRecord`](/api/interfaces/MediaRecord/)

#### Returns

`Promise`\<`void`\>

***

### download()

> **download**(`mediaOrId`, `conversionName?`): `Promise`\<`Response`\>

Defined in: [packages/core/src/library.ts:468](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L468)

Web-standard Response streaming the file from storage — works natively in
Hono/Next/Bun/Deno; use toNodeStream() for Express-style servers. A
generated conversion streams its derived file; an unknown/ungenerated
conversionName gracefully falls back to the original (mirrors url()).

The `Response` is constructed with status 200 as soon as `disk.getStream()`
resolves — that only opens the read, it doesn't confirm the whole file is
readable. If a conversion is marked `generatedConversions[name] === true`
but its file is actually missing from storage (e.g. deleted out from
under a stale record), the 200 response's body errors when the caller
reads it, not up front; there is no way to downgrade to a 404 after the
headers are already committed.

#### Parameters

##### mediaOrId

`string` \| [`MediaRecord`](/api/interfaces/MediaRecord/)

##### conversionName?

`string`

#### Returns

`Promise`\<`Response`\>

***

### for()

> **for**(`modelType`, `modelId`): [`ModelMediaHandle`](/api/classes/ModelMediaHandle/)

Defined in: [packages/core/src/library.ts:245](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L245)

#### Parameters

##### modelType

`string`

##### modelId

`string` \| `number`

#### Returns

[`ModelMediaHandle`](/api/classes/ModelMediaHandle/)

***

### getCollectionDefinition()

> **getCollectionDefinition**(`modelType`, `collection`): [`CollectionDefinition`](/api/interfaces/CollectionDefinition/)

Defined in: [packages/core/src/library.ts:257](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L257)

#### Parameters

##### modelType

`string`

##### collection

`string`

#### Returns

[`CollectionDefinition`](/api/interfaces/CollectionDefinition/)

***

### inline()

> **inline**(`mediaOrId`, `conversionName?`): `Promise`\<`Response`\>

Defined in: [packages/core/src/library.ts:472](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L472)

#### Parameters

##### mediaOrId

`string` \| [`MediaRecord`](/api/interfaces/MediaRecord/)

##### conversionName?

`string`

#### Returns

`Promise`\<`Response`\>

***

### moveMedia()

> **moveMedia**(`mediaOrId`, `toModelType`, `toModelId`, `opts?`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/library.ts:415](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L415)

Move = copy + delete-source (Spatie semantics). If the copy fails the
source record and files are untouched. Derived files regenerate on the
target; they are not carried over.

#### Parameters

##### mediaOrId

`string` \| [`MediaRecord`](/api/interfaces/MediaRecord/)

##### toModelType

`string`

##### toModelId

`string` \| `number`

##### opts?

[`CopyMediaOptions`](/api/interfaces/CopyMediaOptions/) = `{}`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### performConversions()

> **performConversions**(`mediaId`, `names?`): `Promise`\<`void`\>

Defined in: [packages/core/src/library.ts:107](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L107)

Runs `names` (or all applicable) conversions for `mediaId` inline.

#### Parameters

##### mediaId

`string`

##### names?

`string`[]

#### Returns

`Promise`\<`void`\>

***

### placeholder()

> **placeholder**(`mediaOrId`, `conversion?`): `Promise`\<`string` \| `null`\>

Defined in: [packages/core/src/library.ts:341](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L341)

The LQIP base64 SVG data URI for `conversion`, or `null` when absent.

#### Parameters

##### mediaOrId

`string` \| [`MediaRecord`](/api/interfaces/MediaRecord/)

##### conversion?

`string` = `'original'`

#### Returns

`Promise`\<`string` \| `null`\>

***

### regenerate()

> **regenerate**(`opts?`): `Promise`\<\{ `enqueued`: `number`; \}\>

Defined in: [packages/core/src/library.ts:173](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L173)

Re-enqueues conversion generation across a set of media records.
`opts.ids` (when given) selects exactly those records via `findById`,
silently skipping any that don't exist; otherwise every record —
optionally narrowed to `opts.modelType` — is visited via
`repository.iterateAll()`. For each record, the applicable conversion
names are further narrowed by `opts.only` (intersection) and, when
`opts.onlyMissing` is set, by excluding names already marked `true` in
`generatedConversions`. Records left with zero names to regenerate are
skipped entirely — nothing is enqueued for them. Returns the number of
`queue.enqueue()` calls made (one per record with names left to run),
not the number of individual conversions.

With the sync queue driver, a record whose enqueued conversions all
fail rethrows synchronously from `enqueue()`, which aborts this run
mid-iteration — records not yet visited are never dispatched, and the
returned `enqueued` count reflects only what was queued before the
failure.

#### Parameters

##### opts?

[`RegenerateOptions`](/api/interfaces/RegenerateOptions/) = `{}`

#### Returns

`Promise`\<\{ `enqueued`: `number`; \}\>

***

### removeCustomProperty()

> **removeCustomProperty**(`mediaOrId`, `key`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/library.ts:374](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L374)

Remove one custom property atomically (sibling keys preserved).

#### Parameters

##### mediaOrId

`string` \| [`MediaRecord`](/api/interfaces/MediaRecord/)

##### key

`string`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### responsiveUrls()

> **responsiveUrls**(`mediaOrId`, `conversion?`, `opts?`): `Promise`\<`string`[]\>

Defined in: [packages/core/src/library.ts:283](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L283)

Public (or, with `opts.signed`, signed) URLs for `conversion`'s stored
responsive variants (widest first, mirroring stored order). `[]` when
there's no entry, or when the configured `UrlGenerator` doesn't
implement the relevant optional member (`responsiveUrl` /
`responsiveSignedUrl`) — graceful degradation for custom generators
predating responsive images or signed responsive URLs.

#### Parameters

##### mediaOrId

`string` \| [`MediaRecord`](/api/interfaces/MediaRecord/)

##### conversion?

`string` = `'original'`

##### opts?

###### expiresIn?

`string` \| `number`

###### signed?

`boolean`

#### Returns

`Promise`\<`string`[]\>

***

### setCustomProperty()

> **setCustomProperty**(`mediaOrId`, `key`, `value`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/library.ts:364](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L364)

Set one custom property atomically (sibling keys preserved).

#### Parameters

##### mediaOrId

`string` \| [`MediaRecord`](/api/interfaces/MediaRecord/)

##### key

`string`

##### value

`unknown`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### srcset()

> **srcset**(`mediaOrId`, `conversion?`, `opts?`): `Promise`\<`string` \| `null`\>

Defined in: [packages/core/src/library.ts:310](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L310)

`'url1 800w, url2 669w'` srcset string; `null` when there's no entry/empty files.

#### Parameters

##### mediaOrId

`string` \| [`MediaRecord`](/api/interfaces/MediaRecord/)

##### conversion?

`string` = `'original'`

##### opts?

###### expiresIn?

`string` \| `number`

###### signed?

`boolean`

#### Returns

`Promise`\<`string` \| `null`\>

***

### startWorker()

> **startWorker**(`opts?`): `Promise`\<[`QueueWorker`](/api/interfaces/QueueWorker/)\>

Defined in: [packages/core/src/library.ts:119](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L119)

Starts consuming conversion jobs from the configured broker driver.
Call this only in a dedicated worker process — a web process should
construct the library and never call it.

Throws when the configured driver is in-process, since those run
conversions inline and have no separate worker to start.

#### Parameters

##### opts?

[`WorkOptions`](/api/interfaces/WorkOptions/)

#### Returns

`Promise`\<[`QueueWorker`](/api/interfaces/QueueWorker/)\>

***

### updateManipulations()

> **updateManipulations**(`mediaId`, `manipulations`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/library.ts:145](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L145)

Updates `mediaId`'s per-conversion manipulation overrides and dispatches
regeneration for the changed conversions through the queue — per spec
§8, "changing it triggers regeneration". Always goes through the queue
(not inline) regardless of the conversion's own `queued` flag, since
this is an explicit, user-triggered update rather than upload dispatch.

`manipulations` REPLACES the record's full manipulations map — it is
not merged with the existing one. Callers who want to keep prior
overrides for other conversions must include them in this call.

#### Parameters

##### mediaId

`string`

##### manipulations

`Record`\<`string`, [`JsonObject`](/api/type-aliases/JsonObject/)\>

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### zip()

> **zip**(`archiveName`, `items`): `Promise`\<`Response`\>

Defined in: [packages/core/src/library.ts:533](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/library.ts#L533)

Streamed ZIP of `items` (records or ids, mixed disks fine) — no temp
file; entries stream from storage as the archive streams out. Foldering:
a string `customProperties.zipFilenamePrefix` is prepended to that
item's entry name, after `sanitizeZipPrefix()` strips leading slashes,
backslashes, and `.`/`..` segments (zip-slip hardening — this value is
caller-controlled data, not a trusted path). Not for concurrent
mutation: items deleted while the archive streams will abort the
response stream.

Every item is resolved to a `MediaRecord` (and unknown ids fail fast)
BEFORE streaming starts, but no storage read is opened at that point —
each entry's `disk.getStream()` call is deferred until archiver actually
reads that entry. This avoids opening every source file up front (which
can exhaust file descriptors for large archives, or idle out an S3
connection for an entry that won't be read for a while) and means an
item that's never reached (e.g. the archive/response is aborted early)
never opens a storage stream at all. A lazy source's error (missing
file, disk failure, etc.) surfaces as that entry stream's error, which
propagates to the archive and then to the Response body.

#### Parameters

##### archiveName

`string`

##### items

(`string` \| [`MediaRecord`](/api/interfaces/MediaRecord/))[]

#### Returns

`Promise`\<`Response`\>
