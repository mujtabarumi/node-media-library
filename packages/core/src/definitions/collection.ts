import { IncomingFile } from '../types.js'
import { MediaLibraryError } from '../errors.js'
import { ConversionBuilder, ConversionDefinition, conversion } from './conversion.js'

export interface CollectionDefinition {
  singleFile: boolean
  keepLatest: number | null
  acceptsMimeTypes: string[] | null
  acceptsFile: ((file: IncomingFile) => boolean) | null
  disk: string | null
  conversionsDisk: string | null
  public: boolean
  fallbackUrls: Record<string, string>
  conversions: Record<string, ConversionDefinition>
  responsiveImages: boolean
}

export const DEFAULT_COLLECTION: CollectionDefinition = Object.freeze({
  singleFile: false,
  keepLatest: null,
  acceptsMimeTypes: null,
  acceptsFile: null,
  disk: null,
  conversionsDisk: null,
  public: false,
  fallbackUrls: {},
  conversions: {},
  responsiveImages: false,
})

export function matchesMime(pattern: string, mime: string): boolean {
  if (pattern.endsWith('/*')) {
    return mime.startsWith(pattern.slice(0, -1))
  }
  return pattern === mime
}

export class CollectionBuilder {
  private definition: CollectionDefinition

  constructor() {
    this.definition = {
      singleFile: false,
      keepLatest: null,
      acceptsMimeTypes: null,
      acceptsFile: null,
      disk: null,
      conversionsDisk: null,
      public: false,
      fallbackUrls: {},
      conversions: {},
      responsiveImages: false,
    }
  }

  singleFile(): this {
    if (this.definition.keepLatest !== null) {
      throw new MediaLibraryError('singleFile and onlyKeepLatest are mutually exclusive')
    }
    this.definition.singleFile = true
    return this
  }

  onlyKeepLatest(n: number): this {
    if (this.definition.singleFile) {
      throw new MediaLibraryError('singleFile and onlyKeepLatest are mutually exclusive')
    }
    this.definition.keepLatest = n
    return this
  }

  acceptsMimeTypes(types: string[]): this {
    this.definition.acceptsMimeTypes = types
    return this
  }

  acceptsFile(fn: (file: IncomingFile) => boolean): this {
    this.definition.acceptsFile = fn
    return this
  }

  useDisk(name: string): this {
    this.definition.disk = name
    return this
  }

  storeConversionsOnDisk(name: string): this {
    this.definition.conversionsDisk = name
    return this
  }

  public(): this {
    this.definition.public = true
    return this
  }

  fallbackUrl(url: string, conversionName: string = ''): this {
    this.definition.fallbackUrls[conversionName] = url
    return this
  }

  conversions(record: Record<string, ConversionBuilder>): this {
    this.definition.conversions = {}
    for (const [key, builder] of Object.entries(record)) {
      this.definition.conversions[key] = builder.toDefinition()
    }
    return this
  }

  withResponsiveImages(): this {
    this.definition.responsiveImages = true
    return this
  }

  toDefinition(): CollectionDefinition {
    return this.definition
  }
}

export function collection(): CollectionBuilder {
  return new CollectionBuilder()
}
