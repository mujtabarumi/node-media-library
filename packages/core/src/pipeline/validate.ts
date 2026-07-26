import { IncomingFile } from '../types.js'
import { CollectionDefinition, matchesMime } from '../definitions/collection.js'
import { FileTooLargeError, DisallowedExtensionError, UnacceptableFileError } from '../errors.js'

export const DEFAULT_DISALLOWED_EXTENSIONS: readonly string[] = Object.freeze([
  'php',
  'phtml',
  'phar',
  'htaccess',
])

export interface ValidationContext {
  maxFileSize: number
  disallowedExtensions: readonly string[]
  allowedExtensions: readonly string[] | null // when set, FINAL extension must be in it
  collection: CollectionDefinition
}

export function validateFile(file: IncomingFile, ctx: ValidationContext): void {
  if (file.size > ctx.maxFileSize) {
    throw new FileTooLargeError(
      `File "${file.fileName}" (${file.size} bytes) exceeds the maximum allowed size of ${ctx.maxFileSize} bytes`,
    )
  }

  const segments = file.fileName.toLowerCase().split('.').slice(1)

  for (const segment of segments) {
    if (ctx.disallowedExtensions.includes(segment)) {
      throw new DisallowedExtensionError(`File "${file.fileName}" has a disallowed extension: "${segment}"`)
    }
  }

  const finalSegment = segments[segments.length - 1] ?? ''
  if (ctx.allowedExtensions !== null && !ctx.allowedExtensions.includes(finalSegment)) {
    throw new DisallowedExtensionError(
      `File "${file.fileName}" does not have an allowed extension: "${finalSegment}"`,
    )
  }

  const { acceptsMimeTypes, acceptsFile } = ctx.collection

  if (acceptsMimeTypes !== null) {
    if (file.mimeType === null || !acceptsMimeTypes.some((pattern) => matchesMime(pattern, file.mimeType as string))) {
      throw new UnacceptableFileError(
        `File "${file.fileName}" with mime type "${file.mimeType ?? 'unknown'}" is not accepted by this collection`,
      )
    }
  }

  if (acceptsFile && !acceptsFile(file)) {
    throw new UnacceptableFileError(`File "${file.fileName}" was rejected by the collection's acceptsFile check`)
  }
}

export { sanitizeFileName } from './sanitize.js'
export type { FileNameSanitizer } from './sanitize.js'
