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

describe('R2 env synthesis', () => {
  it('MEDIA_R2_ACCOUNT_ID + MEDIA_R2_BUCKET synthesize a private r2 default disk', () => {
    const s = resolveStorage(undefined, {
      MEDIA_R2_ACCOUNT_ID: 'acct',
      MEDIA_R2_BUCKET: 'env-bucket',
    })
    expect(s.diskConfig()).toMatchObject({
      driver: 'r2',
      accountId: 'acct',
      bucket: 'env-bucket',
      visibility: 'private',
    })
  })

  it('MEDIA_R2_BASE_URL and credentials come through', () => {
    const s = resolveStorage(undefined, {
      MEDIA_R2_ACCOUNT_ID: 'acct',
      MEDIA_R2_BUCKET: 'b',
      MEDIA_R2_BASE_URL: 'https://cdn.example.com',
      MEDIA_R2_ACCESS_KEY_ID: 'ak',
      MEDIA_R2_SECRET_ACCESS_KEY: 'sk',
    })
    expect(s.diskConfig()).toMatchObject({
      baseUrl: 'https://cdn.example.com',
      credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
    })
  })

  it('R2 wins over S3 and GCS', () => {
    const s = resolveStorage(undefined, {
      MEDIA_R2_ACCOUNT_ID: 'acct',
      MEDIA_R2_BUCKET: 'r2b',
      MEDIA_S3_BUCKET: 's3b',
      MEDIA_GCS_BUCKET: 'gcsb',
    })
    expect(s.diskConfig()).toMatchObject({ driver: 'r2', bucket: 'r2b' })
  })

  it('MEDIA_R2_ACCOUNT_ID without MEDIA_R2_BUCKET throws instead of falling through', () => {
    expect(() => resolveStorage(undefined, { MEDIA_R2_ACCOUNT_ID: 'acct' })).toThrow(
      /MEDIA_R2_BUCKET/,
    )
  })

  it('credentials are omitted unless both halves are present', () => {
    const s = resolveStorage(undefined, {
      MEDIA_R2_ACCOUNT_ID: 'acct',
      MEDIA_R2_BUCKET: 'b',
      MEDIA_R2_ACCESS_KEY_ID: 'ak',
    })
    expect(s.diskConfig()).not.toHaveProperty('credentials')
  })
})
