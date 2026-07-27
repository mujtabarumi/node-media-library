export interface ConversionDefinition {
  width: number | null
  height: number | null
  fit: 'cover' | 'contain' | 'fill' | 'inside' | 'outside' | null
  format: 'jpeg' | 'png' | 'webp' | 'avif' | null
  quality: number | null
  queued: boolean
  performOnCollections: string[] | null
  responsiveImages: boolean
  position: string | null
  sharpen: boolean
  blur: number | null
  greyscale: boolean
  autoOrient: boolean
  pdfPageNumber: number
  videoFrameAtSecond: number
}

export class ConversionBuilder {
  private definition: ConversionDefinition

  constructor() {
    this.definition = {
      width: null,
      height: null,
      fit: null,
      format: null,
      quality: null,
      queued: true,
      performOnCollections: null,
      responsiveImages: false,
      position: null,
      sharpen: false,
      blur: null,
      greyscale: false,
      autoOrient: true,
      pdfPageNumber: 1,
      videoFrameAtSecond: 0,
    }
  }

  width(n: number): this {
    this.definition.width = n
    return this
  }

  height(n: number): this {
    this.definition.height = n
    return this
  }

  fit(f: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'): this {
    this.definition.fit = f
    return this
  }

  format(f: 'jpeg' | 'png' | 'webp' | 'avif'): this {
    this.definition.format = f
    return this
  }

  quality(n: number): this {
    this.definition.quality = n
    return this
  }

  queued(): this {
    this.definition.queued = true
    return this
  }

  nonQueued(): this {
    this.definition.queued = false
    return this
  }

  performOnCollections(...names: string[]): this {
    this.definition.performOnCollections = names
    return this
  }

  withResponsiveImages(): this {
    this.definition.responsiveImages = true
    return this
  }

  position(p: string): this {
    this.definition.position = p
    return this
  }

  sharpen(): this {
    this.definition.sharpen = true
    return this
  }

  blur(sigma: number): this {
    this.definition.blur = sigma
    return this
  }

  greyscale(): this {
    this.definition.greyscale = true
    return this
  }

  autoOrient(on = true): this {
    this.definition.autoOrient = on
    return this
  }

  keepOriginalFormat(): this {
    this.definition.format = null
    return this
  }

  pdfPageNumber(n: number): this {
    this.definition.pdfPageNumber = n
    return this
  }

  videoFrameAtSecond(s: number): this {
    this.definition.videoFrameAtSecond = s
    return this
  }

  toDefinition(): ConversionDefinition {
    return this.definition
  }
}

export function conversion(): ConversionBuilder {
  return new ConversionBuilder()
}
