export interface JpegoptimOptions {
  /** Path to the `jpegoptim` binary. Default: `'jpegoptim'` (on PATH). */
  jpegoptimPath?: string
  /** Quality cap 0-100. Default: 85. */
  max?: number
}

export interface PngquantOptions {
  /** Path to the `pngquant` binary. Default: `'pngquant'` (on PATH). */
  pngquantPath?: string
  /** Quality range, e.g. '65-90'. Default: undefined (pngquant's own default). */
  quality?: string
}

/** jpegoptim optimizes in place: strip metadata, force progressive, cap quality, file last. */
export function buildJpegoptimArgs(file: string, opts: JpegoptimOptions): string[] {
  const max = opts.max ?? 85
  return ['--strip-all', '--all-progressive', `-m${max}`, file]
}

/** pngquant writes to a separate output file; quality (if given) precedes --output. */
export function buildPngquantArgs(input: string, output: string, opts: PngquantOptions): string[] {
  const args = ['--force']
  if (opts.quality) args.push('--quality', opts.quality)
  args.push('--output', output, input)
  return args
}
