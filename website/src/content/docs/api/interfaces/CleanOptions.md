---
title: 'CleanOptions'
editUrl: false
---
# Interface: CleanOptions

Defined in: [packages/core/src/maintenance/clean.ts:2](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/maintenance/clean.ts#L2)

Options for `MediaLibrary.clean()`.

## Properties

### deleteOrphaned?

> `optional` **deleteOrphaned?**: `boolean`

Defined in: [packages/core/src/maintenance/clean.ts:6](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/maintenance/clean.ts#L6)

Delete media whose owning model no longer exists (per `repository.ownerExists`).

***

### dryRun?

> `optional` **dryRun?**: `boolean`

Defined in: [packages/core/src/maintenance/clean.ts:4](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/maintenance/clean.ts#L4)

Count everything a real run would do, but perform no deletion/update.

***

### rateLimit?

> `optional` **rateLimit?**: `number`

Defined in: [packages/core/src/maintenance/clean.ts:8](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/maintenance/clean.ts#L8)

Max deletions per second across files+records; undefined = unthrottled.
