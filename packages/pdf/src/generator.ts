import type { ConversionDefinition, ImageGenerator } from '@node-media-library/core'
import { sharpImageGenerator } from '@node-media-library/core'
import { buildPdftoppmArgs } from './args.js'
import { renderViaTempFiles } from './run.js'

export interface PdfGeneratorOptions {
  /** Path to the poppler `pdftoppm` binary. Default: `'pdftoppm'` (on PATH). */
  pdftoppmPath?: string
  /** Render resolution. Default 150. */
  dpi?: number
}

/**
 * ImageGenerator for PDFs: renders `def.pdfPageNumber` (default 1) with
 * poppler's `pdftoppm`, then applies the conversion through core's sharp
 * pipeline. `toSourceImage` renders page 1 for original-responsive variants.
 * Requires `pdftoppm` on the system — check with `pdftoppmAvailable()`.
 */
export function pdfImageGenerator(opts: PdfGeneratorOptions = {}): ImageGenerator {
  const binary = opts.pdftoppmPath ?? 'pdftoppm'
  const dpi = opts.dpi ?? 150
  const sharpGen = sharpImageGenerator()

  const renderPage = (input: Buffer, page: number): Promise<Buffer> =>
    renderViaTempFiles(binary, input, (pdfPath, outPrefix) => buildPdftoppmArgs(page, dpi, pdfPath, outPrefix))

  return {
    supports(mimeType) {
      return mimeType === 'application/pdf'
    },
    async toImage(input: Buffer, def: ConversionDefinition): Promise<Buffer> {
      const pageImage = await renderPage(input, def.pdfPageNumber)
      return sharpGen.toImage(pageImage, def)
    },
    async toSourceImage(input: Buffer): Promise<Buffer> {
      return renderPage(input, 1)
    },
  }
}
