import { describe, it, expect } from 'vitest'
import { MediaLibraryError, FileTooLargeError, DisallowedExtensionError } from '../src/errors.js'
describe('errors', () => {
  it('subclasses carry codes and instanceof', () => {
    const e = new FileTooLargeError('too big')
    expect(e).toBeInstanceOf(MediaLibraryError)
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('FILE_TOO_LARGE')
    expect(e.name).toBe('FileTooLargeError')
  })
  it('extension error has its code', () => {
    expect(new DisallowedExtensionError('x').code).toBe('DISALLOWED_EXTENSION')
  })
})
