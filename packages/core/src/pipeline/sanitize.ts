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

  return sanitized.length > 0 ? sanitized : 'file'
}
