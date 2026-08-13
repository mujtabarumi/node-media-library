---
title: 'MediaFilter'
editUrl: false
---
# Interface: MediaFilter

Defined in: [packages/core/src/repository.ts:3](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L3)

## Properties

### collectionName?

> `optional` **collectionName?**: `string`

Defined in: [packages/core/src/repository.ts:5](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L5)

***

### customProperties?

> `optional` **customProperties?**: [`JsonObject`](/api/type-aliases/JsonObject/)

Defined in: [packages/core/src/repository.ts:16](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L16)

Every key must deep-equal the record's corresponding `customProperties`
value. AND across keys; a record missing the key does not match; an
absent or empty object matches everything.

Backends implementing this by hand should call `matchesMediaFilter` so
their semantics match the shared contract exactly. A backend that ignores
this field returns UNFILTERED results, which is dangerous on deletion
paths.

***

### modelType?

> `optional` **modelType?**: `string`

Defined in: [packages/core/src/repository.ts:4](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/repository.ts#L4)
