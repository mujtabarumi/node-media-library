---
title: 'FileAdder'
editUrl: false
---
# Class: FileAdder

Defined in: [packages/core/src/pipeline/file-adder.ts:19](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/pipeline/file-adder.ts#L19)

Fluent builder returned by `ModelMediaHandle.add()`. Configure optional
metadata, then call `toCollection()` to run the pipeline: normalize the
source, validate it against the collection's rules, persist it to disk +
the repository, enforce `singleFile`/`onlyKeepLatest` collection rules,
and emit `media:added`.

## Constructors

### Constructor

> **new FileAdder**(`library`, `modelType`, `modelId`, `source`): `FileAdder`

Defined in: [packages/core/src/pipeline/file-adder.ts:28](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/pipeline/file-adder.ts#L28)

#### Parameters

##### library

[`MediaLibrary`](/api/classes/MediaLibrary/)

##### modelType

`string`

##### modelId

`string`

##### source

[`MediaSource`](/api/type-aliases/MediaSource/)

#### Returns

`FileAdder`

## Methods

### preservingOriginal()

> **preservingOriginal**(): `this`

Defined in: [packages/core/src/pipeline/file-adder.ts:56](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/pipeline/file-adder.ts#L56)

Path sources default to MOVE semantics; call this to copy instead.

#### Returns

`this`

***

### storingConversionsOnDisk()

> **storingConversionsOnDisk**(`disk`): `this`

Defined in: [packages/core/src/pipeline/file-adder.ts:61](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/pipeline/file-adder.ts#L61)

#### Parameters

##### disk

`string`

#### Returns

`this`

***

### toCollection()

> **toCollection**(`collectionName?`): `Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

Defined in: [packages/core/src/pipeline/file-adder.ts:89](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/pipeline/file-adder.ts#L89)

Honesty note: this method reads `existing.length` (for `orderColumn`)
and, in `enforceCollectionRules()`, the sibling list again (for
`singleFile` displacement / `onlyKeepLatest` pruning) with no locking in
between. Two concurrent `add()` calls for the same (modelType, modelId,
collectionName) can each read the same "before" sibling snapshot and
race: both may compute the same `orderColumn`, or a `singleFile`
collection may briefly (or, depending on repository semantics,
permanently) end up with more than one record before the losing call's
displacement pass runs. Callers that need a hard guarantee should
serialize `add()` calls per (model, collection) themselves.

#### Parameters

##### collectionName?

`string` = `'default'`

#### Returns

`Promise`\<[`MediaRecord`](/api/interfaces/MediaRecord/)\>

***

### usingFileName()

> **usingFileName**(`fileName`): `this`

Defined in: [packages/core/src/pipeline/file-adder.ts:40](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/pipeline/file-adder.ts#L40)

#### Parameters

##### fileName

`string`

#### Returns

`this`

***

### usingName()

> **usingName**(`name`): `this`

Defined in: [packages/core/src/pipeline/file-adder.ts:35](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/pipeline/file-adder.ts#L35)

#### Parameters

##### name

`string`

#### Returns

`this`

***

### withCustomProperties()

> **withCustomProperties**(`props`): `this`

Defined in: [packages/core/src/pipeline/file-adder.ts:45](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/pipeline/file-adder.ts#L45)

#### Parameters

##### props

[`JsonObject`](/api/type-aliases/JsonObject/)

#### Returns

`this`

***

### withManipulations()

> **withManipulations**(`manipulations`): `this`

Defined in: [packages/core/src/pipeline/file-adder.ts:50](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/pipeline/file-adder.ts#L50)

#### Parameters

##### manipulations

`Record`\<`string`, [`JsonObject`](/api/type-aliases/JsonObject/)\>

#### Returns

`this`

***

### withResponsiveImages()

> **withResponsiveImages**(): `this`

Defined in: [packages/core/src/pipeline/file-adder.ts:72](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/pipeline/file-adder.ts#L72)

Stored on the record as the `requested` flag. `dispatchConversions()`
checks `conversionEngine.wantsOriginalResponsive()` (collection-level
`withResponsiveImages()` OR this per-add flag) and, when true, queues
`'original'` responsive generation for the media.

#### Returns

`this`
