import type { MediaRecord } from '../types.js'
import { StorageError } from '../errors.js'
import type { PathGenerator } from './path-generator.js'
import type { ResolvedStorage } from './resolve.js'

export interface SignedUrlOptions {
  expiresIn?: string | number
}

export interface UrlGenerator {
  /** Throws StorageError if the disk cannot build public URLs. */
  url(media: MediaRecord, conversionName?: string): Promise<string>
  signedUrl(media: MediaRecord, conversionName?: string, opts?: SignedUrlOptions): Promise<string>
}

export interface UrlGeneratorOptions {
  versionUrls?: boolean
  signedUrlExpiresIn?: string | number
}

export class DefaultUrlGenerator implements UrlGenerator {
  constructor(
    private readonly storage: ResolvedStorage,
    private readonly pathGen: PathGenerator,
    private readonly opts: UrlGeneratorOptions = {},
  ) {}

  private version(media: MediaRecord): string {
    return this.opts.versionUrls ? `?v=${media.updatedAt.getTime()}` : ''
  }

  // conversionName is accepted for the future (Plan 3) but until then only
  // ''/undefined (the original file) is supported — pass through to path().
  async url(media: MediaRecord, conversionName?: string): Promise<string> {
    const path = this.pathGen.path(media)
    void conversionName
    const config = this.storage.diskConfig(media.disk)

    if (config.driver === 'fs' && config.baseUrl) {
      return `${config.baseUrl}/${path}${this.version(media)}`
    }

    try {
      const disk = await this.storage.disk(media.disk)
      const raw = await disk.getUrl(path)
      return `${raw}${this.version(media)}`
    } catch (err) {
      throw new StorageError(
        `Unable to build a public URL for "${path}": ${(err as Error).message}`,
      )
    }
  }

  async signedUrl(
    media: MediaRecord,
    conversionName?: string,
    opts?: SignedUrlOptions,
  ): Promise<string> {
    const path = this.pathGen.path(media)
    void conversionName
    const config = this.storage.diskConfig(media.disk)
    const expiresIn = opts?.expiresIn ?? this.opts.signedUrlExpiresIn

    if (config.driver === 'fs') {
      // fs driver has no signing support without a configured urlBuilder;
      // fall back to the plain public URL (documented dev-mode behavior).
      return this.url(media, conversionName)
    }

    try {
      const disk = await this.storage.disk(media.disk)
      return await disk.getSignedUrl(path, expiresIn !== undefined ? { expiresIn } : undefined)
    } catch (err) {
      throw new StorageError(
        `Unable to build a signed URL for "${path}": ${(err as Error).message}`,
      )
    }
  }
}
