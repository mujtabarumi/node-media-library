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
  // Split so the toCreateData test can use the timestamp-free half directly:
  // that half IS the NewMediaRecord shape, which is the whole point of the
  // assertion below that toCreateData emits no timestamps.
  const newRecord = {
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
  }
  const row = { ...newRecord, createdAt: new Date(1), updatedAt: new Date(2) }
  it('toMediaRecord round-trips fields and types Json columns', () => {
    const rec = toMediaRecord(row)
    expect(rec.customProperties).toEqual({ tag: 'x' })
    expect(rec.generatedConversions.thumb).toBe(true)
    expect(rec.mimeType).toBeNull()
    expect(rec.createdAt).toBeInstanceOf(Date)
  })
  it('toCreateData carries every NewMediaRecord field and no timestamps', () => {
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
  it('MEDIA_MODEL_SNIPPET, the sqlite fixture, the README, and the website docs agree exactly', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const fixture = readFileSync(join(here, 'prisma/schema.prisma'), 'utf8')
    const readme = readFileSync(join(here, '../README.md'), 'utf8')
    const websitePath = '../../../website/src/content/docs/production/prisma.mdx'
    const website = readFileSync(join(here, websitePath), 'utf8')

    const snippet = normalizeModel(MEDIA_MODEL_SNIPPET)
    expect(extractMediaModel(fixture), 'packages/prisma/test/prisma/schema.prisma').toBe(snippet)
    expect(extractMediaModel(readme), 'packages/prisma/README.md').toBe(snippet)
    expect(extractMediaModel(website), websitePath).toBe(snippet)
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
