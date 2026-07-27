import { describe, it, expect } from 'vitest'

describe('public exports', () => {
  // Main exports from core
  it('exports createMediaLibrary', async () => {
    const { createMediaLibrary } = await import('../src/index.js')
    expect(createMediaLibrary).toBeDefined()
  })

  it('exports MediaLibrary', async () => {
    const { MediaLibrary } = await import('../src/index.js')
    expect(MediaLibrary).toBeDefined()
  })

  it('exports collection builder', async () => {
    const { collection } = await import('../src/index.js')
    expect(collection).toBeDefined()
  })

  it('exports conversion builder', async () => {
    const { conversion } = await import('../src/index.js')
    expect(conversion).toBeDefined()
  })

  it('exports matchesMime', async () => {
    const { matchesMime } = await import('../src/index.js')
    expect(matchesMime).toBeDefined()
  })

  it('exports DEFAULT_COLLECTION', async () => {
    const { DEFAULT_COLLECTION } = await import('../src/index.js')
    expect(DEFAULT_COLLECTION).toBeDefined()
  })

  it('exports InMemoryMediaRepository', async () => {
    const { InMemoryMediaRepository } = await import('../src/index.js')
    expect(InMemoryMediaRepository).toBeDefined()
  })

  it('exports TypedEmitter', async () => {
    const { TypedEmitter } = await import('../src/index.js')
    expect(TypedEmitter).toBeDefined()
  })

  it('exports DefaultPathGenerator', async () => {
    const { DefaultPathGenerator } = await import('../src/index.js')
    expect(DefaultPathGenerator).toBeDefined()
  })

  it('exports DefaultUrlGenerator', async () => {
    const { DefaultUrlGenerator } = await import('../src/index.js')
    expect(DefaultUrlGenerator).toBeDefined()
  })

  it('exports resolveStorage', async () => {
    const { resolveStorage } = await import('../src/index.js')
    expect(resolveStorage).toBeDefined()
  })

  it('exports normalizeSource', async () => {
    const { normalizeSource } = await import('../src/index.js')
    expect(normalizeSource).toBeDefined()
  })

  it('exports validateFile', async () => {
    const { validateFile } = await import('../src/index.js')
    expect(validateFile).toBeDefined()
  })

  it('exports sanitizeFileName', async () => {
    const { sanitizeFileName } = await import('../src/index.js')
    expect(sanitizeFileName).toBeDefined()
  })

  it('exports DEFAULT_DISALLOWED_EXTENSIONS', async () => {
    const { DEFAULT_DISALLOWED_EXTENSIONS } = await import('../src/index.js')
    expect(DEFAULT_DISALLOWED_EXTENSIONS).toBeDefined()
  })

  it('exports FileAdder', async () => {
    const { FileAdder } = await import('../src/index.js')
    expect(FileAdder).toBeDefined()
  })

  it('exports ModelMediaHandle', async () => {
    const { ModelMediaHandle } = await import('../src/index.js')
    expect(ModelMediaHandle).toBeDefined()
  })

  // Error classes
  it('exports MediaLibraryError', async () => {
    const { MediaLibraryError } = await import('../src/index.js')
    expect(MediaLibraryError).toBeDefined()
  })

  it('exports FileTooLargeError', async () => {
    const { FileTooLargeError } = await import('../src/index.js')
    expect(FileTooLargeError).toBeDefined()
  })

  it('exports DisallowedExtensionError', async () => {
    const { DisallowedExtensionError } = await import('../src/index.js')
    expect(DisallowedExtensionError).toBeDefined()
  })

  it('exports UnacceptableFileError', async () => {
    const { UnacceptableFileError } = await import('../src/index.js')
    expect(UnacceptableFileError).toBeDefined()
  })

  it('exports UnknownModelError', async () => {
    const { UnknownModelError } = await import('../src/index.js')
    expect(UnknownModelError).toBeDefined()
  })

  it('exports ConversionFailedError', async () => {
    const { ConversionFailedError } = await import('../src/index.js')
    expect(ConversionFailedError).toBeDefined()
  })

  it('exports StorageError', async () => {
    const { StorageError } = await import('../src/index.js')
    expect(StorageError).toBeDefined()
  })

  it('exports DownloadFailedError', async () => {
    const { DownloadFailedError } = await import('../src/index.js')
    expect(DownloadFailedError).toBeDefined()
  })

  // Testing utilities
  it('exports runMediaRepositoryContract from testing subpath', async () => {
    const { runMediaRepositoryContract } = await import('../src/testing/index.js')
    expect(runMediaRepositoryContract).toBeDefined()
  })
})
