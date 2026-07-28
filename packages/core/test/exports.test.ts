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

  // Queue driver exports
  it('exports syncDriver', async () => {
    const { syncDriver } = await import('../src/index.js')
    expect(syncDriver).toBeDefined()
  })

  it('exports deferDriver', async () => {
    const { deferDriver } = await import('../src/index.js')
    expect(deferDriver).toBeDefined()
  })

  it('exports QueueDriver type', async () => {
    const { syncDriver } = await import('../src/index.js')
    const driver: import('../src/index.js').QueueDriver = syncDriver()
    expect(driver).toBeDefined()
  })

  it('exports ConversionJob type', async () => {
    const job: import('../src/index.js').ConversionJob = { mediaId: 'm1', conversionNames: ['thumb'] }
    expect(job).toBeDefined()
  })

  it('exports ConversionProcessor type', async () => {
    const proc: import('../src/index.js').ConversionProcessor = async () => {}
    expect(proc).toBeDefined()
  })

  it('exports ImageGenerator type', async () => {
    const { sharpImageGenerator } = await import('../src/index.js')
    const gen: import('../src/index.js').ImageGenerator = sharpImageGenerator()
    expect(gen).toBeDefined()
  })

  it('exports sharpImageGenerator', async () => {
    const { sharpImageGenerator } = await import('../src/index.js')
    expect(sharpImageGenerator).toBeDefined()
  })

  it('exports conversionFileName', async () => {
    const { conversionFileName } = await import('../src/index.js')
    expect(conversionFileName).toBeDefined()
  })

  it('exports RegenerateOptions type', async () => {
    const opts: import('../src/index.js').RegenerateOptions = {}
    expect(opts).toBeDefined()
  })

  // Responsive images
  it('exports FileSizeOptimizedWidthCalculator', async () => {
    const { FileSizeOptimizedWidthCalculator } = await import('../src/index.js')
    expect(FileSizeOptimizedWidthCalculator).toBeDefined()
  })

  it('exports WidthCalculator type', async () => {
    const calc: import('../src/index.js').WidthCalculator = {
      calculateWidths: () => [800],
    }
    expect(calc).toBeDefined()
  })

  it('exports responsiveFileName', async () => {
    const { responsiveFileName } = await import('../src/index.js')
    expect(responsiveFileName).toBeDefined()
  })

  it('exports ResponsiveVariant type', async () => {
    const variant: import('../src/index.js').ResponsiveVariant = {
      fileName: 'photo___original_800_600.jpg',
      width: 800,
      height: 600,
    }
    expect(variant).toBeDefined()
  })

  it('exports ResponsiveImagesEntry type', async () => {
    const entry: import('../src/index.js').ResponsiveImagesEntry = { files: [] }
    expect(entry).toBeDefined()
  })

  it('exports renderVariant', async () => {
    const { renderVariant } = await import('../src/index.js')
    expect(renderVariant).toBeDefined()
  })

  it('exports RenderedVariant type', async () => {
    const rendered: import('../src/index.js').RenderedVariant = {
      buffer: Buffer.alloc(0),
      width: 1,
      height: 1,
    }
    expect(rendered).toBeDefined()
  })

  it('exports tinyPlaceholder', async () => {
    const { tinyPlaceholder } = await import('../src/index.js')
    expect(tinyPlaceholder).toBeDefined()
  })

  // Downloads
  it('exports toNodeStream', async () => {
    const { toNodeStream } = await import('../src/index.js')
    expect(toNodeStream).toBeDefined()
  })

  it('exports contentDisposition', async () => {
    const { contentDisposition } = await import('../src/index.js')
    expect(contentDisposition).toBeDefined()
  })

  it('exports zipEntryName', async () => {
    const { zipEntryName } = await import('../src/index.js')
    expect(zipEntryName).toBeDefined()
  })

  // Testing utilities
  it('exports runMediaRepositoryContract from testing subpath', async () => {
    const { runMediaRepositoryContract } = await import('../src/testing/index.js')
    expect(runMediaRepositoryContract).toBeDefined()
  })

  it('exports runQueueDriverContract from testing subpath', async () => {
    const { runQueueDriverContract } = await import('../src/testing/index.js')
    expect(runQueueDriverContract).toBeDefined()
  })

  // Maintenance
  it('exports DeleteRateGate', async () => {
    const { DeleteRateGate } = await import('../src/index.js')
    expect(DeleteRateGate).toBeDefined()
  })

  it('exports CleanOptions type', async () => {
    const opts: import('../src/index.js').CleanOptions = { dryRun: true, deleteOrphaned: true, rateLimit: 5 }
    expect(opts).toBeDefined()
  })

  it('exports CleanResult type', async () => {
    const result: import('../src/index.js').CleanResult = {
      orphanedMediaDeleted: 0,
      staleFilesDeleted: 0,
      staleEntriesRemoved: 0,
      dryRun: false,
    }
    expect(result).toBeDefined()
  })
})
