import { extname, basename } from 'node:path'

/**
 * Entry name inside the archive: `${prefix}${fileName}`, deduplicated against
 * `taken` by inserting `-2`, `-3`, ... before the extension. Mutates `taken`.
 */
export function zipEntryName(fileName: string, prefix: string, taken: Set<string>): string {
  const base = `${prefix}${fileName}`
  let candidate = base
  let n = 2
  while (taken.has(candidate)) {
    const ext = extname(fileName)
    const stem = basename(fileName, ext)
    candidate = `${prefix}${stem}-${n}${ext}`
    n += 1
  }
  taken.add(candidate)
  return candidate
}
