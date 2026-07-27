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
  /**
   * Public URL for a responsive variant file (as stored in
   * `ResponsiveImagesEntry.files[].fileName`). Optional so custom
   * `UrlGenerator` implementations that predate responsive images keep
   * compiling; library read methods (`responsiveUrls`/`srcset`) degrade
   * gracefully to `[]`/`null` when it's absent.
   */
  responsiveUrl?(media: MediaRecord, fileName: string): Promise<string>
}

export interface UrlGeneratorOptions {
  versionUrls?: boolean
  signedUrlExpiresIn?: string | number
  /**
   * Resolves the on-disk filename for `name`'s conversion of `media`, or
   * `null` when that conversion isn't defined/applicable. Optional so
   * existing callers (and Plan 1's generators.test.ts) that construct
   * `DefaultUrlGenerator` directly, without this dep, keep the original
   * "conversionName is a no-op" behavior.
   */
  conversionFileNameFor?: (media: MediaRecord, name: string) => string | null
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

  /**
   * Resolves `(path, disk)` for `media`/`conversionName`. When a real,
   * generated, resolvable conversion is requested, points at the conversion
   * file on `conversionsDisk ?? disk`; otherwise falls back to the original
   * file on `disk` — the "graceful fallback" behavior for unknown/ungenerated
   * conversion names, and the unchanged default when `conversionFileNameFor`
   * isn't supplied at all.
   */
  private resolveTarget(media: MediaRecord, conversionName?: string): { path: string; disk: string } {
    if (conversionName && this.opts.conversionFileNameFor && media.generatedConversions[conversionName] === true) {
      const fileName = this.opts.conversionFileNameFor(media, conversionName)
      if (fileName) {
        return {
          path: `${this.pathGen.conversionsPath(media)}/${fileName}`,
          disk: media.conversionsDisk ?? media.disk,
        }
      }
    }
    return { path: this.pathGen.path(media), disk: media.disk }
  }

  async url(media: MediaRecord, conversionName?: string): Promise<string> {
    const { path, disk: diskName } = this.resolveTarget(media, conversionName)
    return this.publicUrlFor(path, diskName, media)
  }

  /**
   * Public URL for `path` on `diskName`: fs-baseUrl short-circuit, otherwise
   * `disk.getUrl()`, plus the `?v=` versioning suffix when enabled. Shared by
   * `url()` and `responsiveUrl()` so the two never drift.
   */
  private async publicUrlFor(path: string, diskName: string, media: MediaRecord): Promise<string> {
    const config = this.storage.diskConfig(diskName)

    if (config.driver === 'fs' && config.baseUrl) {
      const baseUrl = config.baseUrl.replace(/\/+$/, '')
      return `${baseUrl}/${path}${this.version(media)}`
    }

    try {
      const disk = await this.storage.disk(diskName)
      const raw = await disk.getUrl(path)
      return `${raw}${this.version(media)}`
    } catch (err) {
      throw new StorageError(
        `Unable to build a public URL for "${path}": ${(err as Error).message}`,
      )
    }
  }

  async responsiveUrl(media: MediaRecord, fileName: string): Promise<string> {
    return this.publicUrlFor(`${this.pathGen.responsivePath(media)}/${fileName}`, media.disk, media)
  }

  async signedUrl(
    media: MediaRecord,
    conversionName?: string,
    opts?: SignedUrlOptions,
  ): Promise<string> {
    const { path, disk: diskName } = this.resolveTarget(media, conversionName)
    const config = this.storage.diskConfig(diskName)
    const expiresIn = opts?.expiresIn ?? this.opts.signedUrlExpiresIn

    if (config.driver === 'fs') {
      // fs driver has no signing support without a configured urlBuilder;
      // fall back to the plain public URL (documented dev-mode behavior).
      // Note: `expiresIn` (whether from opts or signedUrlExpiresIn) is
      // ignored on this path since url() has no concept of expiry — the
      // returned URL never actually expires.
      return this.url(media, conversionName)
    }

    try {
      const disk = await this.storage.disk(diskName)
      return await disk.getSignedUrl(path, expiresIn !== undefined ? { expiresIn } : undefined)
    } catch (err) {
      throw new StorageError(
        `Unable to build a signed URL for "${path}": ${(err as Error).message}`,
      )
    }
  }
}
