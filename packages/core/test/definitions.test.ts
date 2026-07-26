import { describe, it, expect } from 'vitest'
import { collection, conversion, matchesMime, DEFAULT_COLLECTION } from '../src/index.js'
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
})
