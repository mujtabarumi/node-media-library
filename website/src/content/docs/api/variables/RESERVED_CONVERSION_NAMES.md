---
title: 'RESERVED\_CONVERSION\_NAMES'
editUrl: false
---
# Variable: RESERVED\_CONVERSION\_NAMES

> `const` **RESERVED\_CONVERSION\_NAMES**: readonly `string`[]

Defined in: [packages/core/src/definitions/collection.ts:39](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/definitions/collection.ts#L39)

Conversion names that collide with responsive-images pseudo-conversions:
`'original'` names the responsive-images entry for the source file itself,
and `'requested'` is the per-add opt-in flag stored in
`media.responsiveImages`. Defining a real conversion under either name
would silently shadow that machinery.
