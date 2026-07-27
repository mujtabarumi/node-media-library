import type { MediaRecord } from '../types.js'
import type { MediaRepository } from '../repository.js'
import type { ResolvedStorage } from '../storage/resolve.js'
import type { PathGenerator } from '../storage/path-generator.js'
import type { TypedEmitter } from '../events.js'
import type { MediaEventMap } from '../events.js'
import type { ConversionDefinition } from '../definitions/conversion.js'
import type { ImageGenerator } from './image-generator.js'
import { conversionKey } from './naming.js'

export interface RegenerateOptions {
  modelType?: string
  ids?: string[]
  only?: string[]
  onlyMissing?: boolean
}

export interface ConversionEngineDeps {
  repository: MediaRepository
  storage: ResolvedStorage
  pathGenerator: PathGenerator
  events: TypedEmitter<MediaEventMap>
  generators: ImageGenerator[]
  definitionsFor(modelType: string, collection: string): Record<string, ConversionDefinition>
}

export class ConversionEngine {
  constructor(private readonly deps: ConversionEngineDeps) {}

  /**
   * Definitions for `media`'s own collection, filtered by
   * `performOnCollections` (null = applies to every collection it's
   * requested for; otherwise the media's collectionName must be listed) and
   * with any per-media `manipulations[name]` shallow-merged over the
   * matching definition's fields.
   */
  applicable(media: MediaRecord): Record<string, ConversionDefinition> {
    const defs = this.deps.definitionsFor(media.modelType, media.collectionName)
    const result: Record<string, ConversionDefinition> = {}

    for (const [name, def] of Object.entries(defs)) {
      if (def.performOnCollections !== null && !def.performOnCollections.includes(media.collectionName)) {
        continue
      }
      const overrides = media.manipulations[name]
      result[name] = overrides ? { ...def, ...overrides } : def
    }

    return result
  }

  /**
   * Loads `mediaId` and generates the applicable conversions (optionally
   * narrowed to `names`). Missing media, or media with no supporting
   * generator, resolves silently — the job simply outlived its media, or
   * there's nothing this engine can do with it. Per-conversion failures
   * emit `conversion:failed` and don't stop the remaining conversions; the
   * call only rejects if every requested conversion failed.
   */
  async perform(mediaId: string, names?: string[]): Promise<void> {
    const media = await this.deps.repository.findById(mediaId)
    if (!media) return

    const generator = this.deps.generators.find((g) => g.supports(media.mimeType))
    if (!generator) return

    const applicable = this.applicable(media)
    const entries = names
      ? Object.entries(applicable).filter(([name]) => names.includes(name))
      : Object.entries(applicable)

    if (entries.length === 0) return

    const disk = await this.deps.storage.disk(media.disk)
    const original = await disk.getBytes(this.deps.pathGenerator.path(media))
    const originalBuffer = Buffer.from(original)

    const conversionsDisk = await this.deps.storage.disk(media.conversionsDisk ?? media.disk)

    let failures = 0

    for (const [name, def] of entries) {
      this.deps.events.emit('conversion:started', { media, conversion: name })
      try {
        const output = await generator.toImage(originalBuffer, def)
        const key = conversionKey(media, this.deps.pathGenerator, def, name)
        await conversionsDisk.put(key, output)
        const updated = await this.deps.repository.update(media.id, {
          generatedConversions: { ...media.generatedConversions, [name]: true },
        })
        media.generatedConversions = updated.generatedConversions
        this.deps.events.emit('conversion:completed', { media, conversion: name })
      } catch (error) {
        failures += 1
        this.deps.events.emit('conversion:failed', { media, conversion: name, error })
      }
    }

    if (failures === entries.length) {
      throw new Error(`All ${failures} requested conversion(s) failed for media "${mediaId}"`)
    }
  }
}
