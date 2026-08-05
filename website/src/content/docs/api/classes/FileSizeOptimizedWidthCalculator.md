---
title: 'FileSizeOptimizedWidthCalculator'
editUrl: false
---
# Class: FileSizeOptimizedWidthCalculator

Defined in: [packages/core/src/responsive/width-calculator.ts:15](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/responsive/width-calculator.ts#L15)

Port of Spatie's FileSizeOptimizedWidthCalculator: each successive variant
targets ~70% of the previous predicted file size. Since file size scales
with pixel area at constant "pixel price" (bytes per pixel), width shrinks
by sqrt(0.7) per step. Stops once the predicted size drops below 10KB or
the width below 20px.

## Implements

- [`WidthCalculator`](/api/interfaces/WidthCalculator/)

## Constructors

### Constructor

> **new FileSizeOptimizedWidthCalculator**(): `FileSizeOptimizedWidthCalculator`

#### Returns

`FileSizeOptimizedWidthCalculator`

## Methods

### calculateWidths()

> **calculateWidths**(`fileSizeBytes`, `width`, `height`): `number`[]

Defined in: [packages/core/src/responsive/width-calculator.ts:16](https://github.com/mujtabarumi/node-media-library/blob/main/packages/core/src/responsive/width-calculator.ts#L16)

#### Parameters

##### fileSizeBytes

`number`

##### width

`number`

##### height

`number`

#### Returns

`number`[]

#### Implementation of

[`WidthCalculator`](/api/interfaces/WidthCalculator/).[`calculateWidths`](/api/interfaces/WidthCalculator/#calculatewidths)
