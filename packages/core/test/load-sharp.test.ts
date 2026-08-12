import { describe, it, expect } from 'vitest'
import { loadSharp } from '../src/conversions/load-sharp.js'
import { MediaLibraryError } from '../src/errors.js'

function throwingImporter(message: string, code: string): () => Promise<never> {
  return () => {
    const err = new Error(message) as Error & { code: string }
    err.code = code
    return Promise.reject(err)
  }
}

describe('loadSharp', () => {
  it('returns the sharp module when it is installed', async () => {
    const sharp = await loadSharp()
    expect(typeof sharp).toBe('function')
  })

  it('tells you to install sharp when the module is absent', async () => {
    const importer = throwingImporter("Cannot find package 'sharp'", 'ERR_MODULE_NOT_FOUND')
    await expect(loadSharp(importer)).rejects.toThrow(MediaLibraryError)
    await expect(loadSharp(importer)).rejects.toThrow(/optional peer dependency/)
    await expect(loadSharp(importer)).rejects.toThrow(/imageGenerators/)
  })

  it('distinguishes an unloadable native binary from an absent module', async () => {
    const importer = throwingImporter(
      'Could not load the sharp module using the darwin-arm64 runtime',
      'ERR_DLOPEN_FAILED',
    )
    await expect(loadSharp(importer)).rejects.toThrow(MediaLibraryError)
    await expect(loadSharp(importer)).rejects.toThrow(/could not be loaded on this platform/)
  })

  it('reports the underlying error without prescribing a fix when the cause is unrecognized', async () => {
    const importer = throwingImporter('EACCES: permission denied', 'EACCES')
    await expect(loadSharp(importer)).rejects.toThrow(MediaLibraryError)
    await expect(loadSharp(importer)).rejects.toThrow(/EACCES: permission denied/)
    await expect(loadSharp(importer)).rejects.not.toThrow(/rebuild sharp/)
  })
})
