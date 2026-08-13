---
title: 'matchesMediaFilter'
editUrl: false
---
# Function: matchesMediaFilter()

> **matchesMediaFilter**(`record`, `filter?`): `boolean`

Defined in: [packages/core/src/repository/match.ts:39](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository/match.ts#L39)

Whether `record` satisfies `filter`.

Exported so third-party `MediaRepository` backends can implement
`iterateAll` filtering with the exact semantics
`runMediaRepositoryContract` asserts, rather than reimplementing them and
diverging.

## Parameters

### record

[`MediaRecord`](/api/interfaces/MediaRecord/)

### filter?

[`MediaFilter`](/api/interfaces/MediaFilter/)

## Returns

`boolean`
