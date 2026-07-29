import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveStorage } from '../src/storage/resolve.js'
afterEach(() => vi.restoreAllMocks())
describe('resolveStorage', () => {
  it('defaults to fs disk when no s3 env present', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ml-'))
    const s = resolveStorage(undefined, { MEDIA_FS_ROOT: root })
    expect(s.defaultDisk).toBe('default')
    expect(s.diskConfig()).toMatchObject({ driver: 'fs', root })
    const disk = await s.disk()
    await disk.put('probe.txt', 'hello')
    expect(await disk.get('probe.txt')).toBe('hello')
  })
  it('prefers s3 when bucket env present', () => {
    const s = resolveStorage(undefined, { MEDIA_S3_BUCKET: 'b', MEDIA_S3_REGION: 'us-east-1' })
    expect(s.diskConfig()).toMatchObject({ driver: 's3', bucket: 'b' })
  })
  it('explicit config wins over env', () => {
    const s = resolveStorage(
      { disks: { default: { driver: 'fs', root: '/x' } } },
      { MEDIA_S3_BUCKET: 'b' },
    )
    expect(s.diskConfig()).toMatchObject({ driver: 'fs', root: '/x' })
  })
  it('warns once in production on fs driver, without env var names', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    resolveStorage(undefined, { NODE_ENV: 'production' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).not.toMatch(/MEDIA_|AWS_/)
  })
  it('reads prefix from config then env', () => {
    expect(resolveStorage({ prefix: 'app' }, { MEDIA_PREFIX: 'ignored' }).prefix).toBe('app')
    expect(resolveStorage(undefined, { MEDIA_PREFIX: 'from-env' }).prefix).toBe('from-env')
  })
})
