import { describe, it, expect } from 'vitest'
import { collection, conversion, matchesMime, DEFAULT_COLLECTION, RESERVED_CONVERSION_NAMES } from '../src/index.js'
describe('definition builders', () => {
  it('collection builder produces plain serializable data', () => {
    const def = collection().singleFile().acceptsMimeTypes(['image/*'])
      .public().fallbackUrl('/img/default.png')
      .conversions({ thumb: conversion().width(368).height(232).fit('cover').nonQueued() })
      .toDefinition()
    expect(def.singleFile).toBe(true)
    expect(def.public).toBe(true)
    expect(def.fallbackUrls['']).toBe('/img/default.png')
    expect(def.conversions.thumb).toMatchObject({ width: 368, height: 232, fit: 'cover', queued: false })
    expect(JSON.parse(JSON.stringify({ ...def, acceptsFile: undefined }))).toBeTruthy()
  })
  it('onlyKeepLatest and singleFile are mutually exclusive', () => {
    expect(() => collection().singleFile().onlyKeepLatest(3)).toThrow()
  })
  it('conversion defaults: queued, keep-original format', () => {
    const def = conversion().width(100).toDefinition()
    expect(def.queued).toBe(true); expect(def.format).toBeNull()
  })
  it('matchesMime wildcard and exact', () => {
    expect(matchesMime('image/*', 'image/png')).toBe(true)
    expect(matchesMime('image/*', 'video/mp4')).toBe(false)
    expect(matchesMime('image/png', 'image/png')).toBe(true)
  })
  it('DEFAULT_COLLECTION nested objects are deeply frozen', () => {
    expect(Object.isFrozen(DEFAULT_COLLECTION)).toBe(true)
    expect(Object.isFrozen(DEFAULT_COLLECTION.fallbackUrls)).toBe(true)
    expect(Object.isFrozen(DEFAULT_COLLECTION.conversions)).toBe(true)
    // Verify mutation attempts fail or are ignored
    const urlsBefore = DEFAULT_COLLECTION.fallbackUrls
    const conversionsBefore = DEFAULT_COLLECTION.conversions
    // Mutation attempts in strict mode throw TypeError
    expect(() => {
      DEFAULT_COLLECTION.fallbackUrls['thumb'] = '/mutated'
    }).toThrow()
    expect(() => {
      DEFAULT_COLLECTION.conversions['mutated'] = undefined as any
    }).toThrow()
    // Verify the objects are unchanged after attempted mutation
    expect(DEFAULT_COLLECTION.fallbackUrls).toBe(urlsBefore)
    expect(DEFAULT_COLLECTION.conversions).toBe(conversionsBefore)
    expect(DEFAULT_COLLECTION.fallbackUrls['thumb']).toBeUndefined()
    expect(DEFAULT_COLLECTION.conversions['mutated']).toBeUndefined()
  })
  it('conversions() rejects reserved names ("original", "requested")', () => {
    for (const name of RESERVED_CONVERSION_NAMES) {
      expect(() => collection().conversions({ [name]: conversion().width(100) })).toThrow()
    }
  })
  it('conversions() still accepts a normal name', () => {
    const def = collection().conversions({ thumb: conversion().width(100) }).toDefinition()
    expect(def.conversions.thumb).toMatchObject({ width: 100 })
  })
  it('extended conversion surface: effects, autoOrient default, generator hints', () => {
    const def = conversion().width(100).position('attention').sharpen().blur(3)
      .greyscale().autoOrient(false).pdfPageNumber(2).videoFrameAtSecond(5).toDefinition()
    expect(def).toMatchObject({ position: 'attention', sharpen: true, blur: 3, greyscale: true, autoOrient: false, pdfPageNumber: 2, videoFrameAtSecond: 5 })
    expect(conversion().toDefinition().autoOrient).toBe(true)
    expect(conversion().format('webp').keepOriginalFormat().toDefinition().format).toBeNull()
  })
})
