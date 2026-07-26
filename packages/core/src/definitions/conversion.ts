export interface ConversionDefinition {
  width: number | null
  height: number | null
  fit: 'cover' | 'contain' | 'fill' | 'inside' | 'outside' | null
  format: 'jpeg' | 'png' | 'webp' | 'avif' | null
  quality: number | null
  queued: boolean
  performOnCollections: string[] | null
  responsiveImages: boolean
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

  toDefinition(): ConversionDefinition {
    return this.definition
  }
}

export function conversion(): ConversionBuilder {
  return new ConversionBuilder()
}
