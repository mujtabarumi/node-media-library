import { extname, basename } from 'node:path'
import type { MediaRecord } from '../types.js'
import type { PathGenerator } from '../storage/path-generator.js'
import type { ConversionDefinition } from '../definitions/conversion.js'

/**
 * `'photo.jpg','thumb',null` → `'photo-thumb.jpg'`; `'photo.jpg','web','webp'`
 * → `'photo-web.webp'`; extensionless `'file','t',null` → `'file-t'`.
 * @internal
 */
export function conversionFileName(
  originalFileName: string,
  conversionName: string,
  format: string | null,
): string {
  const ext = extname(originalFileName)
  const base = basename(originalFileName, ext)
  const outExt = format ? `.${format}` : ext
  return `${base}-${conversionName}${outExt}`
}

/** @internal */
export function conversionKey(
  media: MediaRecord,
  pathGen: PathGenerator,
  def: ConversionDefinition,
  name: string,
): string {
  return `${pathGen.conversionsPath(media)}/${conversionFileName(media.fileName, name, def.format)}`
}
