import { basename } from 'node:path'

export type FileNameSanitizer = (fileName: string) => string

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g
const DISALLOWED_CHARS = /[<>:"/\\|?*]/g
const WHITESPACE = /\s+/g
const LEADING_DOTS = /^\.+/

export function sanitizeFileName(fileName: string): string {
  const base = basename(fileName)
  const sanitized = base
    .replace(CONTROL_CHARS, '')
    .replace(DISALLOWED_CHARS, '')
    .replace(WHITESPACE, '-')
    .replace(LEADING_DOTS, '')

  // A result of only dashes (e.g. from whitespace/control-only input) is
  // effectively empty — fall back rather than returning a bare "-" filename.
  return /^-*$/.test(sanitized) ? 'file' : sanitized
}
