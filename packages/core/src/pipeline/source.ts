import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Readable } from 'node:stream'
import { fileTypeFromBuffer } from 'file-type'
import { DownloadFailedError, MediaLibraryError } from '../errors.js'

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

async function collectReadable(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
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

async function downloadUrl(url: string, allowedHosts?: string[]): Promise<Buffer> {
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

  const response = await fetch(parsed)
  if (!response.ok) {
    throw new DownloadFailedError(`Download failed with status ${response.status} for "${url}"`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export async function normalizeSource(source: MediaSource): Promise<NormalizedSource> {
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
    const buffer = await collectReadable(source)
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
    const buffer = await downloadUrl(source.url, source.allowedHosts)
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
