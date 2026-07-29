import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { Readable } from 'node:stream'
import { normalizeSource } from '../src/pipeline/source.js'
import { DownloadFailedError, FileTooLargeError, MediaLibraryError } from '../src/errors.js'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const PNG_BUFFER = Buffer.from(PNG_BASE64, 'base64')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizeSource', () => {
  it('normalizes a filesystem path source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nml-source-'))
    const filePath = join(dir, 'pixel.png')
    await writeFile(filePath, PNG_BUFFER)

    try {
      const result = await normalizeSource(filePath)
      expect(result.sniffedMime).toBe('image/png')
      expect(result.originalFileName).toBe(basename(filePath))
      expect(result.sourcePath).toBe(filePath)
      expect(result.buffer.equals(PNG_BUFFER)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('normalizes a Buffer source', async () => {
    const result = await normalizeSource(PNG_BUFFER)
    expect(result.sniffedMime).toBe('image/png')
    expect(result.originalFileName).toBeNull()
    expect(result.sourcePath).toBeNull()
    expect(result.buffer.equals(PNG_BUFFER)).toBe(true)
  })

  it('normalizes a valid base64 object and throws MediaLibraryError for invalid base64', async () => {
    const result = await normalizeSource({ base64: PNG_BASE64, fileName: 'pixel.png' })
    expect(result.sniffedMime).toBe('image/png')
    expect(result.originalFileName).toBe('pixel.png')
    expect(result.sourcePath).toBeNull()
    expect(result.buffer.equals(PNG_BUFFER)).toBe(true)

    await expect(normalizeSource({ base64: '!!!' })).rejects.toThrow(MediaLibraryError)
  })

  it('downloads a url source on 200 and throws DownloadFailedError on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        PNG_BUFFER.buffer.slice(
          PNG_BUFFER.byteOffset,
          PNG_BUFFER.byteOffset + PNG_BUFFER.byteLength,
        ),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await normalizeSource({ url: 'https://example.com/pixel.png' })
    expect(result.sniffedMime).toBe('image/png')
    expect(result.originalFileName).toBe('pixel.png')
    expect(result.sourcePath).toBeNull()
    expect(result.buffer.equals(PNG_BUFFER)).toBe(true)

    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })
    await expect(normalizeSource({ url: 'https://example.com/missing.png' })).rejects.toThrow(
      DownloadFailedError,
    )
  })

  it('rejects a url source with a disallowed host without calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      normalizeSource({
        url: 'https://evil.example.com/pixel.png',
        allowedHosts: ['cdn.example.com'],
      }),
    ).rejects.toThrow(DownloadFailedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('matches allowedHosts case-insensitively', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        PNG_BUFFER.buffer.slice(
          PNG_BUFFER.byteOffset,
          PNG_BUFFER.byteOffset + PNG_BUFFER.byteLength,
        ),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await normalizeSource({
      url: 'http://cdn.example.com/a.png',
      allowedHosts: ['CDN.Example.COM'],
    })
    expect(result.sniffedMime).toBe('image/png')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('passes redirect: "error" to fetch so allowlisted hosts cannot redirect elsewhere', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () =>
        PNG_BUFFER.buffer.slice(
          PNG_BUFFER.byteOffset,
          PNG_BUFFER.byteOffset + PNG_BUFFER.byteLength,
        ),
    })
    vi.stubGlobal('fetch', fetchMock)

    await normalizeSource({ url: 'https://example.com/pixel.png' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(options).toMatchObject({ redirect: 'error' })
  })

  it('rejects a url source whose Content-Length exceeds maxBytes without reading the body', async () => {
    const arrayBufferMock = vi.fn()
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? '1000' : null) },
      arrayBuffer: arrayBufferMock,
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      normalizeSource({ url: 'https://example.com/huge.png' }, { maxBytes: 100 }),
    ).rejects.toThrow(DownloadFailedError)
    expect(arrayBufferMock).not.toHaveBeenCalled()
  })

  it('rejects a Readable stream source that exceeds maxBytes mid-read', async () => {
    const bigChunk = Buffer.alloc(200, 1)
    const stream = Readable.from([bigChunk])

    await expect(normalizeSource(stream, { maxBytes: 100 })).rejects.toThrow(FileTooLargeError)
  })
})
