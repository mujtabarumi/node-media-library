import { extname, basename } from 'node:path'

/**
 * `'photo.jpg','thumb',800,600,null` → `'photo___thumb_800_600.jpg'`.
 * `format` overrides the output extension (mirrors conversionFileName).
 */
export function responsiveFileName(
  originalFileName: string,
  conversionName: string,
  width: number,
  height: number,
  format: string | null,
): string {
  const ext = extname(originalFileName)
  const base = basename(originalFileName, ext)
  const outExt = format ? `.${format}` : ext
  return `${base}___${conversionName}_${width}_${height}${outExt}`
}
