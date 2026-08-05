import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DownloadFailedError } from '@node-media-library/core'
import { createLibrary, importAvatar } from '../src/url-import.js'

async function library() {
  return createLibrary(await mkdtemp(join(tmpdir(), 'nml-url-')))
}

/**
 * Only rejection paths are covered. Each fails before any network call, so
 * these run offline and deterministically — a test that actually downloaded
 * from the public internet would be flaky and would not prove anything about
 * the allowlist anyway.
 */
describe('Importing from a URL', () => {
  it('rejects a host that is not on the allowlist', async () => {
    await expect(
      importAvatar(await library(), 'u1', 'https://evil.example.com/photo.jpg'),
    ).rejects.toThrow(DownloadFailedError)
  })

  it('treats a port mismatch as a different host — fails closed', async () => {
    // The check compares `host` (which includes the port), not `hostname`.
    await expect(
      importAvatar(await library(), 'u1', 'https://cdn.partner.com:8443/photo.jpg'),
    ).rejects.toThrow(/not in allowedHosts/)
  })

  it('rejects a non-HTTP protocol', async () => {
    await expect(importAvatar(await library(), 'u1', 'file:///etc/passwd')).rejects.toThrow(
      /Unsupported protocol/,
    )
  })

  it('rejects a malformed URL', async () => {
    await expect(importAvatar(await library(), 'u1', 'not-a-url')).rejects.toThrow(/Invalid URL/)
  })
})
