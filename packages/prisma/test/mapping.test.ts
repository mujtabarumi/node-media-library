import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { toMediaRecord, toCreateData } from '../src/mapping.js'
import { MEDIA_MODEL_SNIPPET } from '../src/schema.js'

function normalizeModel(block: string): string {
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n')
}

function extractMediaModel(source: string): string {
  const match = source.match(/model Media \{[\s\S]*?\n\}/)
  if (!match) throw new Error('no `model Media { ... }` block found')
  return normalizeModel(match[0])
}

describe('mapping', () => {
  const row = {
    id: 'm1',
    modelType: 'User',
    modelId: '1',
    uuid: 'u-1',
    collectionName: 'default',
    name: 'a',
    fileName: 'a.jpg',
    mimeType: null,
    disk: 'default',
    conversionsDisk: null,
    size: 5,
    manipulations: {},
    customProperties: { tag: 'x' },
    generatedConversions: { thumb: true },
    responsiveImages: {},
    orderColumn: 2,
    createdAt: new Date(1),
    updatedAt: new Date(2),
  }
  it('toMediaRecord round-trips fields and types Json columns', () => {
    const rec = toMediaRecord(row)
    expect(rec.customProperties).toEqual({ tag: 'x' })
    expect(rec.generatedConversions.thumb).toBe(true)
    expect(rec.mimeType).toBeNull()
    expect(rec.createdAt).toBeInstanceOf(Date)
  })
  it('toCreateData carries every NewMediaRecord field and no timestamps', () => {
    const { createdAt: _c, updatedAt: _u, ...newRecord } = row
    const data = toCreateData({
      ...newRecord,
      manipulations: {},
      customProperties: {},
      generatedConversions: {},
      responsiveImages: {},
    })
    expect(data.id).toBe('m1')
    expect('createdAt' in data).toBe(false)
    expect('updatedAt' in data).toBe(false)
  })
  it('MEDIA_MODEL_SNIPPET, the sqlite fixture, and the README agree exactly', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const fixture = readFileSync(join(here, 'prisma/schema.prisma'), 'utf8')
    const readme = readFileSync(join(here, '../README.md'), 'utf8')

    const snippet = normalizeModel(MEDIA_MODEL_SNIPPET)
    expect(extractMediaModel(fixture)).toBe(snippet)
    expect(extractMediaModel(readme)).toBe(snippet)
  })
})

describe('index.ts exports', () => {
  it('exports value exports from index.js', async () => {
    const {
      toMediaRecord: toMR,
      toCreateData: toCD,
      MEDIA_MODEL_SNIPPET: snippet,
    } = await import('../src/index.js')
    expect(toMR).toBeDefined()
    expect(toCD).toBeDefined()
    expect(snippet).toBeDefined()
  })
})
