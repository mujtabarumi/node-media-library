import { extname, basename } from 'node:path'

/**
 * `zipFilenamePrefix` comes from a media record's `customProperties` — a
 * caller-controlled value that gets prepended into a ZIP entry name. Without
 * sanitization, a hostile prefix like `"../../etc/"` (zip-slip) could steer
 * the entry name outside the archive's intended folder structure once an
 * extracting tool resolves the `..` segments. Backslashes are dropped
 * outright rather than treated as a path separator (archive entry names are
 * POSIX-style `/`-separated regardless of the writer's platform); leading
 * slashes are stripped so the prefix can never start an entry as if it were
 * archive-root-absolute; `.`/`..` segments are dropped rather than resolved,
 * since resolving them would require knowing what they're relative to.
 */
export function sanitizeZipPrefix(prefix: string): string {
  const noBackslashes = prefix.replace(/\\/g, '')
  const noLeadingSlashes = noBackslashes.replace(/^\/+/, '')
  const segments = noLeadingSlashes
    .split('/')
    .filter((segment) => segment !== '.' && segment !== '..')
  return segments.join('/')
}

/**
 * Entry name inside the archive: `${prefix}${fileName}`, deduplicated against
 * `taken` by inserting `-2`, `-3`, ... before the extension. Mutates `taken`.
 * `prefix` is sanitized via `sanitizeZipPrefix()` before use.
 */
export function zipEntryName(fileName: string, prefix: string, taken: Set<string>): string {
  const safePrefix = sanitizeZipPrefix(prefix)
  const base = `${safePrefix}${fileName}`
  let candidate = base
  let n = 2
  while (taken.has(candidate)) {
    const ext = extname(fileName)
    const stem = basename(fileName, ext)
    candidate = `${safePrefix}${stem}-${n}${ext}`
    n += 1
  }
  taken.add(candidate)
  return candidate
}
