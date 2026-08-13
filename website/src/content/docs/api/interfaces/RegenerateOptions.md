---
title: 'RegenerateOptions'
editUrl: false
---
# Interface: RegenerateOptions

Defined in: [packages/core/src/conversions/engine.ts:19](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/engine.ts#L19)

## Properties

### ids?

> `optional` **ids?**: `string`[]

Defined in: [packages/core/src/conversions/engine.ts:21](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/engine.ts#L21)

***

### modelType?

> `optional` **modelType?**: `string`

Defined in: [packages/core/src/conversions/engine.ts:20](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/engine.ts#L20)

***

### only?

> `optional` **only?**: `string`[]

Defined in: [packages/core/src/conversions/engine.ts:22](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/engine.ts#L22)

***

### onlyMissing?

> `optional` **onlyMissing?**: `boolean`

Defined in: [packages/core/src/conversions/engine.ts:23](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/engine.ts#L23)

***

### withResponsive?

> `optional` **withResponsive?**: `boolean`

Defined in: [packages/core/src/conversions/engine.ts:30](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/conversions/engine.ts#L30)

When true, appends the `'original'` responsive-regeneration sentinel to
each record's dispatch names whenever `wantsOriginalResponsive(record)`.
Under `onlyMissing`, only when `record.responsiveImages['original']` is
absent. `only` (which reasons about conversion names) never gates it.
