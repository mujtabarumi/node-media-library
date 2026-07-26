import { describe, it, expect } from 'vitest'
import { validateFile, sanitizeFileName, DEFAULT_DISALLOWED_EXTENSIONS, ValidationContext } from '../src/pipeline/validate.js'
import { DEFAULT_COLLECTION } from '../src/definitions/collection.js'
import { FileTooLargeError, DisallowedExtensionError, UnacceptableFileError } from '../src/errors.js'
import type { IncomingFile } from '../src/types.js'

function baseCtx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    maxFileSize: 1024,
    disallowedExtensions: DEFAULT_DISALLOWED_EXTENSIONS,
    allowedExtensions: null,
    collection: DEFAULT_COLLECTION,
    ...overrides,
  }
}

describe('validateFile', () => {
  it('throws FileTooLargeError when file size exceeds maxFileSize', () => {
    const file: IncomingFile = { fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 2048 }
    expect(() => validateFile(file, baseCtx({ maxFileSize: 1024 }))).toThrow(FileTooLargeError)
  })

  it('throws DisallowedExtensionError for evil.php and evil.php.jpg', () => {
    const ctx = baseCtx()
    const single: IncomingFile = { fileName: 'evil.php', mimeType: null, size: 10 }
    const multi: IncomingFile = { fileName: 'evil.php.jpg', mimeType: 'image/jpeg', size: 10 }
    expect(() => validateFile(single, ctx)).toThrow(DisallowedExtensionError)
    expect(() => validateFile(multi, ctx)).toThrow(DisallowedExtensionError)
  })

  it('passes photo.jpg with mime image/jpeg against acceptsMimeTypes: ["image/*"]', () => {
    const ctx = baseCtx({ collection: { ...DEFAULT_COLLECTION, acceptsMimeTypes: ['image/*'] } })
    const file: IncomingFile = { fileName: 'photo.jpg', mimeType: 'image/jpeg', size: 10 }
    expect(() => validateFile(file, ctx)).not.toThrow()
  })

  it('throws UnacceptableFileError for application/pdf against acceptsMimeTypes: ["image/*"]', () => {
    const ctx = baseCtx({ collection: { ...DEFAULT_COLLECTION, acceptsMimeTypes: ['image/*'] } })
    const file: IncomingFile = { fileName: 'doc.pdf', mimeType: 'application/pdf', size: 10 }
    expect(() => validateFile(file, ctx)).toThrow(UnacceptableFileError)
  })

  it('rejects a 200-byte file when acceptsFile requires size < 100', () => {
    const ctx = baseCtx({
      collection: { ...DEFAULT_COLLECTION, acceptsFile: (f) => f.size < 100 },
    })
    const file: IncomingFile = { fileName: 'big.jpg', mimeType: 'image/jpeg', size: 200 }
    expect(() => validateFile(file, ctx)).toThrow(UnacceptableFileError)
  })
})

describe('sanitizeFileName', () => {
  it('strips directory components and disallowed characters', () => {
    const result = sanitizeFileName('../../etc/pass wd<x>.png')
    expect(result).not.toMatch(/[\/\\<>]/)
    expect(result).toMatch(/\.png$/)
  })
})
