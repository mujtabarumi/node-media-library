---
title: 'RegenerateOptions'
editUrl: false
---
# Interface: RegenerateOptions

Defined in: [packages/core/src/conversions/engine.ts:18](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/engine.ts#L18)

## Properties

### ids?

> `optional` **ids?**: `string`[]

Defined in: [packages/core/src/conversions/engine.ts:20](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/engine.ts#L20)

***

### modelType?

> `optional` **modelType?**: `string`

Defined in: [packages/core/src/conversions/engine.ts:19](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/engine.ts#L19)

***

### only?

> `optional` **only?**: `string`[]

Defined in: [packages/core/src/conversions/engine.ts:21](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/engine.ts#L21)

***

### onlyMissing?

> `optional` **onlyMissing?**: `boolean`

Defined in: [packages/core/src/conversions/engine.ts:22](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/engine.ts#L22)

***

### withResponsive?

> `optional` **withResponsive?**: `boolean`

Defined in: [packages/core/src/conversions/engine.ts:29](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/engine.ts#L29)

When true, appends the `'original'` responsive-regeneration sentinel to
each record's dispatch names whenever `wantsOriginalResponsive(record)`.
Under `onlyMissing`, only when `record.responsiveImages['original']` is
absent. `only` (which reasons about conversion names) never gates it.
