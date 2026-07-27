import type { ConversionDefinition } from '../definitions/conversion.js'

const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/svg+xml',
])

export interface ImageGenerator {
  supports(mimeType: string | null): boolean
  toImage(input: Buffer, def: ConversionDefinition): Promise<Buffer>
}

export function sharpImageGenerator(): ImageGenerator {
  return {
    supports(mimeType) {
      return mimeType !== null && SUPPORTED_MIME_TYPES.has(mimeType)
    },

    async toImage(input, def) {
      const sharp = (await import('sharp')).default
      let pipeline = sharp(input)

      if (def.autoOrient) {
        pipeline = pipeline.rotate()
      }

      if (def.width || def.height) {
        pipeline = pipeline.resize({
          width: def.width ?? undefined,
          height: def.height ?? undefined,
          fit: def.fit ?? 'cover',
          position: def.position ?? undefined,
        })
      }

      if (def.greyscale) {
        pipeline = pipeline.greyscale()
      }

      if (def.blur !== null) {
        pipeline = pipeline.blur(def.blur)
      }

      if (def.sharpen) {
        pipeline = pipeline.sharpen()
      }

      if (def.format) {
        pipeline = pipeline.toFormat(def.format, { quality: def.quality ?? undefined })
      } else if (def.quality !== null) {
        // Reuse `pipeline`'s own metadata instead of decoding `input` a
        // second time via a fresh `sharp(input)` instance — `.metadata()`
        // doesn't consume the pipeline, so it's still chainable afterward.
        const { format } = await pipeline.metadata()
        if (format) {
          // `format` is a plain string at the type level (it's read off
          // already-decoded image bytes), while `toFormat` wants the
          // narrower `keyof FormatEnum | AvailableFormatInfo`. Both are
          // structurally strings here, so a targeted cast is safe.
          pipeline = pipeline.toFormat(format as Parameters<typeof pipeline.toFormat>[0], {
            quality: def.quality,
          })
        }
      }

      return pipeline.toBuffer()
    },
  }
}
