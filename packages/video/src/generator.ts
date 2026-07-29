import type { ConversionDefinition, ImageGenerator } from '@node-media-library/core'
import { sharpImageGenerator } from '@node-media-library/core'
import { buildFfmpegFrameArgs } from './args.js'
import { extractViaTempFiles } from './run.js'

export interface VideoGeneratorOptions {
  /** Path to the ffmpeg binary. Default: `'ffmpeg'` (on PATH). */
  ffmpegPath?: string
}

/**
 * ImageGenerator for videos: extracts the frame at `def.videoFrameAtSecond`
 * (default 0) with ffmpeg, then applies the conversion through core's sharp
 * pipeline. `toSourceImage` extracts the frame at 0s. Requires `ffmpeg` on
 * the system — check with `ffmpegAvailable()`.
 */
export function videoImageGenerator(opts: VideoGeneratorOptions = {}): ImageGenerator {
  const binary = opts.ffmpegPath ?? 'ffmpeg'
  const sharpGen = sharpImageGenerator()

  const extractFrame = (input: Buffer, atSecond: number): Promise<Buffer> =>
    extractViaTempFiles(binary, input, (videoPath, outPath) =>
      buildFfmpegFrameArgs(atSecond, videoPath, outPath),
    )

  return {
    supports(mimeType) {
      return mimeType !== null && mimeType.startsWith('video/')
    },
    async toImage(input: Buffer, def: ConversionDefinition): Promise<Buffer> {
      const frame = await extractFrame(input, def.videoFrameAtSecond)
      return sharpGen.toImage(frame, def)
    },
    async toSourceImage(input: Buffer): Promise<Buffer> {
      return extractFrame(input, 0)
    },
  }
}
