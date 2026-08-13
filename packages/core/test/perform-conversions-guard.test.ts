import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { MediaLibraryError } from '../src/errors.js'

function makeLibrary() {
  const root = mkdtempSync(join(tmpdir(), 'ml-guard-'))
  return createMediaLibrary({
    repository: new InMemoryMediaRepository(),
    storage: { disks: { default: { driver: 'fs', root } } },
    models: {},
  })
}

describe('performConversions argument validation', () => {
  it('rejects a non-string mediaId before reaching the engine', async () => {
    const library = makeLibrary()
    await expect(library.performConversions(undefined as unknown as string)).rejects.toThrow(
      MediaLibraryError,
    )
    await expect(library.performConversions(undefined as unknown as string)).rejects.toThrow(
      /"mediaId" must be a string/,
    )
  })

  it('rejects conversionNames that is not an array of strings', async () => {
    const library = makeLibrary()
    await expect(
      library.performConversions('some-id', [1, 2] as unknown as string[]),
    ).rejects.toThrow(/"conversionNames" must be absent or an array of strings/)
  })

  it('accepts an absent conversionNames', async () => {
    const library = makeLibrary()
    // The id does not exist, and the engine resolves silently for missing
    // media — so reaching that no-op proves validation let it through.
    await expect(library.performConversions('missing-id')).resolves.toBeUndefined()
  })
})
