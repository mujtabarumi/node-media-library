import { describe, it, expect } from 'vitest'
import { DefaultPathGenerator } from '../src/storage/path-generator.js'
import { DefaultUrlGenerator } from '../src/storage/url-generator.js'
import { resolveStorage } from '../src/storage/resolve.js'
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
const media = { id: 'm1', fileName: 'photo.jpg', disk: 'default', updatedAt: new Date(1750000000000) } as any
describe('DefaultPathGenerator', () => {
  it('builds id-based paths with prefix', () => {
    const g = new DefaultPathGenerator('app')
    expect(g.path(media)).toBe('app/m1/photo.jpg')
    expect(g.directory(media)).toBe('app/m1')
    expect(g.conversionsPath(media)).toBe('app/m1/conversions')
  })
  it('omits empty prefix cleanly', () => {
    expect(new DefaultPathGenerator().path(media)).toBe('m1/photo.jpg')
  })
})
describe('DefaultUrlGenerator', () => {
  it('builds public url from fs baseUrl and appends version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ml-'))
    const storage = resolveStorage({ disks: { default: { driver: 'fs', root, baseUrl: 'http://localhost:9000/media' } } })
    const u = new DefaultUrlGenerator(storage, new DefaultPathGenerator(), { versionUrls: true })
    expect(await u.url(media)).toBe('http://localhost:9000/media/m1/photo.jpg?v=1750000000000')
  })
})
