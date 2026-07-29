import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir, platform } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { MediaRecord } from '@node-media-library/core'
import { jpegoptimOptimizer, pngquantOptimizer, jpegoptimAvailable, pngquantAvailable } from '../src/optimizers.js'

const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url))

const fakeMedia: MediaRecord = {
  id: 'm1', modelType: 'Post', modelId: 'p1', uuid: 'u1',
  collectionName: 'default', name: 'sample', fileName: 'sample.jpg',
  mimeType: 'image/jpeg', disk: 'default', conversionsDisk: null,
  size: 0,
  manipulations: {},
  customProperties: {},
  generatedConversions: {},
  responsiveImages: {},
  orderColumn: null,
  createdAt: new Date(), updatedAt: new Date(),
}

function ctx(format: 'jpeg' | 'png' | 'webp' | 'avif' | null) {
  return { format, fileName: 'sample', media: fakeMedia, kind: 'conversion' as const }
}

describe('jpegoptimOptimizer (no binary needed)', () => {
  it('returns null for non-jpeg formats', async () => {
    const optimizer = jpegoptimOptimizer()
    expect(await optimizer.optimize(Buffer.from('x'), ctx('webp'))).toBeNull()
    expect(await optimizer.optimize(Buffer.from('x'), ctx('png'))).toBeNull()
    expect(await optimizer.optimize(Buffer.from('x'), ctx(null))).toBeNull()
  })

  it('returns null when the binary is missing', async () => {
    const optimizer = jpegoptimOptimizer({ jpegoptimPath: '/nonexistent/jpegoptim' })
    const input = await readFile(`${fixturesDir}sample.jpg`)
    expect(await optimizer.optimize(input, ctx('jpeg'))).toBeNull()
  })
})

describe('pngquantOptimizer (no binary needed)', () => {
  it('returns null for non-png formats', async () => {
    const optimizer = pngquantOptimizer()
    expect(await optimizer.optimize(Buffer.from('x'), ctx('webp'))).toBeNull()
    expect(await optimizer.optimize(Buffer.from('x'), ctx('jpeg'))).toBeNull()
    expect(await optimizer.optimize(Buffer.from('x'), ctx(null))).toBeNull()
  })

  it('returns null when the binary is missing', async () => {
    const optimizer = pngquantOptimizer({ pngquantPath: '/nonexistent/pngquant' })
    const input = await readFile(`${fixturesDir}sample.png`)
    expect(await optimizer.optimize(input, ctx('png'))).toBeNull()
  })

  // Exit code 99 is pngquant's "couldn't meet the requested --quality" signal
  // (common on already-small/well-compressed PNGs) — not a real failure. This
  // is exercised with a tiny fake executable rather than the real pngquant
  // binary so it runs everywhere, unconditionally. POSIX-only (shebang script
  // + execute bit); skipped on Windows where that mechanism doesn't apply.
  describe.runIf(platform() !== 'win32')('exit code 99 (fake binary, no pngquant needed)', () => {
    let dir: string | undefined

    afterEach(async () => {
      if (dir) await rm(dir, { recursive: true, force: true })
      dir = undefined
    })

    it('treats it as "could not improve" and returns null rather than throwing', async () => {
      dir = await mkdtemp(join(tmpdir(), 'nml-pngquant-fake-'))
      const fakeBin = join(dir, 'pngquant-exit99')
      await writeFile(fakeBin, '#!/bin/sh\nexit 99\n')
      await chmod(fakeBin, 0o755)

      const optimizer = pngquantOptimizer({ pngquantPath: fakeBin })
      const input = await readFile(`${fixturesDir}sample.png`)
      await expect(optimizer.optimize(input, ctx('png'))).resolves.toBeNull()
    })
  })
})

const jpegoptimReady = await jpegoptimAvailable()
const pngquantReady = await pngquantAvailable()

describe.runIf(jpegoptimReady)('jpegoptimOptimizer (jpegoptim required)', () => {
  it('optimizes a jpeg fixture in place, output not larger than input', async () => {
    const input = await readFile(`${fixturesDir}sample.jpg`)
    const output = await jpegoptimOptimizer().optimize(input, ctx('jpeg'))
    expect(output === null || output.length <= input.length).toBe(true)
    if (output !== null) {
      expect(output[0]).toBe(0xff)
      expect(output[1]).toBe(0xd8)
    }
  })
})

describe.runIf(!jpegoptimReady)('jpegoptim missing on this machine', () => {
  it('skips the binary-backed tests (install jpegoptim to run them)', () => {
    expect(jpegoptimReady).toBe(false)
  })
})

describe.runIf(pngquantReady)('pngquantOptimizer (pngquant required)', () => {
  it('optimizes a png fixture to a separate output, not larger than input', async () => {
    const input = await readFile(`${fixturesDir}sample.png`)
    const output = await pngquantOptimizer().optimize(input, ctx('png'))
    expect(output === null || output.length <= input.length).toBe(true)
    if (output !== null) {
      expect(output.subarray(0, 4).toString('latin1')).toBe('\x89PNG')
    }
  })
})

describe.runIf(!pngquantReady)('pngquant missing on this machine', () => {
  it('skips the binary-backed tests (install pngquant to run them)', () => {
    expect(pngquantReady).toBe(false)
  })
})
