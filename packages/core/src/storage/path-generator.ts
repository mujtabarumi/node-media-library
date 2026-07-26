import type { MediaRecord } from '../types.js'

export interface PathGenerator {
  /** Path to the original file. */
  path(media: MediaRecord): string
  /** Directory holding derived conversion files. */
  conversionsPath(media: MediaRecord): string
  /** Directory holding responsive image variants. */
  responsivePath(media: MediaRecord): string
  /** Root directory for this media item (used e.g. for delete). */
  directory(media: MediaRecord): string
}

export class DefaultPathGenerator implements PathGenerator {
  constructor(private readonly prefix?: string) {}

  private base(): string {
    return this.prefix ? `${this.prefix}/` : ''
  }

  directory(media: MediaRecord): string {
    return `${this.base()}${media.id}`
  }

  path(media: MediaRecord): string {
    return `${this.directory(media)}/${media.fileName}`
  }

  conversionsPath(media: MediaRecord): string {
    return `${this.directory(media)}/conversions`
  }

  responsivePath(media: MediaRecord): string {
    return `${this.directory(media)}/responsive`
  }
}
