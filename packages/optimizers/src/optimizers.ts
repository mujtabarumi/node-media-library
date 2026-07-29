import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImageOptimizer } from '@node-media-library/core'
import { buildJpegoptimArgs, buildPngquantArgs, type JpegoptimOptions, type PngquantOptions } from './args.js'
import { binaryAvailable, runBinary } from './run.js'

export type { JpegoptimOptions, PngquantOptions } from './args.js'

/** True when the jpegoptim binary is present on the system. */
export async function jpegoptimAvailable(path = 'jpegoptim'): Promise<boolean> {
  return binaryAvailable(path, ['--version'])
}

/** True when the pngquant binary is present on the system. */
export async function pngquantAvailable(path = 'pngquant'): Promise<boolean> {
  return binaryAvailable(path, ['--version'])
}

/**
 * ImageOptimizer backed by jpegoptim. Handles `ctx.format === 'jpeg'` only;
 * returns null (pass) for other formats or when the binary is missing.
 * jpegoptim optimizes in place, so the temp file is written, optimized, then read back.
 */
export function jpegoptimOptimizer(opts: JpegoptimOptions = {}): ImageOptimizer {
  const bin = opts.jpegoptimPath ?? 'jpegoptim'
  return {
    name: 'jpegoptim',
    async optimize(buffer, ctx) {
      if (ctx.format !== 'jpeg') return null
      const dir = await mkdtemp(join(tmpdir(), 'nml-jpegoptim-'))
      try {
        const file = join(dir, 'in.jpg')
        await writeFile(file, buffer)
        try {
          await runBinary(bin, buildJpegoptimArgs(file, opts))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        }
        return await readFile(file)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}

/**
 * ImageOptimizer backed by pngquant. Handles `ctx.format === 'png'` only;
 * returns null (pass) for other formats or when the binary is missing.
 * pngquant writes to a separate output file.
 */
export function pngquantOptimizer(opts: PngquantOptions = {}): ImageOptimizer {
  const bin = opts.pngquantPath ?? 'pngquant'
  return {
    name: 'pngquant',
    async optimize(buffer, ctx) {
      if (ctx.format !== 'png') return null
      const dir = await mkdtemp(join(tmpdir(), 'nml-pngquant-'))
      try {
        const input = join(dir, 'in.png')
        const output = join(dir, 'out.png')
        await writeFile(input, buffer)
        try {
          await runBinary(bin, buildPngquantArgs(input, output, opts))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        }
        return await readFile(output)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  }
}
