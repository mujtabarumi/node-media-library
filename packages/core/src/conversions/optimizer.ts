import type { MediaRecord } from '../types.js'

export interface OptimizeContext {
  /** Effective output format; null means the original file's own format. */
  format: 'jpeg' | 'png' | 'webp' | 'avif' | null
  fileName: string
  media: MediaRecord
  kind: 'conversion' | 'responsive'
}

export interface ImageOptimizer {
  name: string
  /** Return optimized bytes, or null to pass (unsupported format / binary missing). */
  optimize(buffer: Buffer, ctx: OptimizeContext): Promise<Buffer | null>
}
