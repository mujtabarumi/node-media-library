---
title: 'CleanResult'
editUrl: false
---
# Interface: CleanResult

Defined in: [packages/core/src/maintenance/clean.ts:12](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/maintenance/clean.ts#L12)

Summary counters returned by `MediaLibrary.clean()`.

## Properties

### dryRun

> **dryRun**: `boolean`

Defined in: [packages/core/src/maintenance/clean.ts:33](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/maintenance/clean.ts#L33)

***

### orphanedMediaDeleted

> **orphanedMediaDeleted**: `number`

Defined in: [packages/core/src/maintenance/clean.ts:13](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/maintenance/clean.ts#L13)

***

### skippedUnregistered

> **skippedUnregistered**: `number`

Defined in: [packages/core/src/maintenance/clean.ts:28](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/maintenance/clean.ts#L28)

Total records skipped entirely for staleness checks (files + JSON left
untouched) because either (a) their modelType/collection isn't
registered in the config `clean()` was run with, or (b) they have
generated conversions but no configured `imageGenerator` supports their
mimeType. Both cases mean `applicable()`/`effectiveFormat()` can't be
trusted to describe what's actually on disk, so treating their existing
derived files as stale would delete real, still-referenced files. Does
NOT include orphaned-media deletions (`orphanedMediaDeleted`), which are
driven by `repository.ownerExists` and unaffected by config
registration. Equal to `skippedUnregisteredTargets + skippedWithoutGenerator`.

***

### skippedUnregisteredTargets

> **skippedUnregisteredTargets**: `number`

Defined in: [packages/core/src/maintenance/clean.ts:30](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/maintenance/clean.ts#L30)

Skipped: record's modelType/collection isn't registered in this config.

***

### skippedWithoutGenerator

> **skippedWithoutGenerator**: `number`

Defined in: [packages/core/src/maintenance/clean.ts:32](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/maintenance/clean.ts#L32)

Skipped: record has generated conversions but no registered imageGenerator supports its mimeType.

***

### staleEntriesRemoved

> **staleEntriesRemoved**: `number`

Defined in: [packages/core/src/maintenance/clean.ts:15](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/maintenance/clean.ts#L15)

***

### staleFilesDeleted

> **staleFilesDeleted**: `number`

Defined in: [packages/core/src/maintenance/clean.ts:14](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/maintenance/clean.ts#L14)
