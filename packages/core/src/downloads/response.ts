import { Readable } from 'node:stream'
import { MediaLibraryError } from '../errors.js'

/** Adapter for Node-stream servers (Express/Fastify): `response.body` as a Readable. */
export function toNodeStream(response: Response): Readable {
  if (!response.body) {
    throw new MediaLibraryError('Response has no body to stream')
  }
  return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
}

/**
 * `Content-Disposition` value with an ASCII-sanitized filename (spec §11):
 * printable ASCII only, `"` and `\` replaced too, so the header never needs
 * escaping or RFC 5987 encoding.
 */
export function contentDisposition(kind: 'attachment' | 'inline', fileName: string): string {
  const safe = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return `${kind}; filename="${safe}"`
}
