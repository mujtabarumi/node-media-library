import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Readable } from 'node:stream'
import { fileTypeFromBuffer } from 'file-type'
import { DownloadFailedError, FileTooLargeError, MediaLibraryError } from '../errors.js'

export type MediaSource =
  | string // filesystem path (default semantics: MOVE)
  | Buffer
  | Readable
  | File
  | Blob
  | { base64: string; fileName?: string }
  | { url: string; allowedHosts?: string[] }

export interface NormalizedSource {
  buffer: Buffer
  originalFileName: string | null
  sniffedMime: string | null
  sourcePath: string | null
}

export interface NormalizeSourceOptions {
  /** When set, caps how many bytes are buffered while collecting a stream/url source. */
  maxBytes?: number
}

function isReadable(value: unknown): value is Readable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Readable).pipe === 'function' &&
    typeof (value as Readable).on === 'function'
  )
}

function isBlobLike(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

function isFileLike(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File
}

/**
 * Accumulates chunks from any async-iterable byte source, throwing
 * `FileTooLargeError` as soon as the running total exceeds `maxBytes` —
 * rather than buffering the whole body first and checking after the fact.
 */
async function collectCapped(
  iterable: AsyncIterable<Buffer | Uint8Array | string>,
  maxBytes: number | undefined,
  describe: string,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of iterable) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (maxBytes !== undefined && total > maxBytes) {
      throw new FileTooLargeError(
        `${describe} exceeded the maximum allowed size of ${maxBytes} bytes`,
      )
    }
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

async function collectReadable(stream: Readable, maxBytes?: number): Promise<Buffer> {
  return collectCapped(stream, maxBytes, 'Stream source')
}

function decodeBase64(base64: string): Buffer {
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.toString('base64') !== base64) {
    throw new MediaLibraryError('invalid base64')
  }
  return buffer
}

function basenameFromUrl(url: URL): string | null {
  const name = basename(url.pathname)
  return name.length > 0 ? name : null
}

async function downloadUrl(url: string, allowedHosts?: string[], maxBytes?: number): Promise<Buffer> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new DownloadFailedError(`Invalid URL "${url}"`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DownloadFailedError(`Unsupported protocol "${parsed.protocol}"`)
  }

  // Compare against `.host` (not `.hostname`) intentionally: this includes the port, so
  // `cdn.example.com` in allowedHosts does not match `cdn.example.com:8443` — fails closed.
  // WHATWG URL already lowercases the hostname portion, so only the allowlist needs lowercasing.
  if (allowedHosts && !allowedHosts.map((h) => h.toLowerCase()).includes(parsed.host.toLowerCase())) {
    throw new DownloadFailedError(`Host "${parsed.host}" is not in allowedHosts`)
  }

  // `redirect: 'error'` is load-bearing for the allowlist above: without it,
  // fetch silently follows a 3xx to an arbitrary (possibly internal) host,
  // defeating the check entirely (SSRF via redirect).
  const response = await fetch(parsed, { redirect: 'error' })
  if (!response.ok) {
    throw new DownloadFailedError(`Download failed with status ${response.status} for "${url}"`)
  }

  if (maxBytes !== undefined) {
    const contentLengthHeader = response.headers?.get?.('content-length')
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader)
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw new DownloadFailedError(
          `Download for "${url}" declares Content-Length ${contentLength} bytes, exceeding the maximum allowed size of ${maxBytes} bytes`,
        )
      }
    }

    const body = response.body as unknown
    if (body != null && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
      return collectCapped(body as AsyncIterable<Uint8Array>, maxBytes, `Download of "${url}"`)
    }
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  if (maxBytes !== undefined && buffer.length > maxBytes) {
    throw new FileTooLargeError(
      `Download of "${url}" exceeded the maximum allowed size of ${maxBytes} bytes`,
    )
  }
  return buffer
}

export async function normalizeSource(
  source: MediaSource,
  opts?: NormalizeSourceOptions,
): Promise<NormalizedSource> {
  const maxBytes = opts?.maxBytes
  if (typeof source === 'string') {
    const buffer = await readFile(source)
    const sniffed = await fileTypeFromBuffer(buffer)
    return {
      buffer,
      originalFileName: basename(source),
      sniffedMime: sniffed?.mime ?? null,
      sourcePath: source,
    }
  }

  if (Buffer.isBuffer(source)) {
    const sniffed = await fileTypeFromBuffer(source)
    return { buffer: source, originalFileName: null, sniffedMime: sniffed?.mime ?? null, sourcePath: null }
  }

  if (isFileLike(source)) {
    const buffer = Buffer.from(await source.arrayBuffer())
    const sniffed = await fileTypeFromBuffer(buffer)
    return {
      buffer,
      originalFileName: source.name ?? null,
      sniffedMime: sniffed?.mime ?? null,
      sourcePath: null,
    }
  }

  if (isBlobLike(source)) {
    const buffer = Buffer.from(await source.arrayBuffer())
    const sniffed = await fileTypeFromBuffer(buffer)
    return { buffer, originalFileName: null, sniffedMime: sniffed?.mime ?? null, sourcePath: null }
  }

  if (isReadable(source)) {
    const buffer = await collectReadable(source, maxBytes)
    const sniffed = await fileTypeFromBuffer(buffer)
    return { buffer, originalFileName: null, sniffedMime: sniffed?.mime ?? null, sourcePath: null }
  }

  if (typeof source === 'object' && source !== null && 'base64' in source) {
    const buffer = decodeBase64(source.base64)
    const sniffed = await fileTypeFromBuffer(buffer)
    return {
      buffer,
      originalFileName: source.fileName ?? null,
      sniffedMime: sniffed?.mime ?? null,
      sourcePath: null,
    }
  }

  if (typeof source === 'object' && source !== null && 'url' in source) {
    const buffer = await downloadUrl(source.url, source.allowedHosts, maxBytes)
    const sniffed = await fileTypeFromBuffer(buffer)
    const parsed = new URL(source.url)
    return {
      buffer,
      originalFileName: basenameFromUrl(parsed),
      sniffedMime: sniffed?.mime ?? null,
      sourcePath: null,
    }
  }

  throw new MediaLibraryError('Unsupported media source')
}
