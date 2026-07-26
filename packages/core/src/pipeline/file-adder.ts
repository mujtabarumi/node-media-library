import { unlink } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { fileTypeFromBuffer } from 'file-type'
import type { MediaLibrary } from '../library.js'
import type { CollectionDefinition } from '../definitions/collection.js'
import type { JsonObject, MediaRecord, NewMediaRecord } from '../types.js'
import type { MediaSource, NormalizedSource } from './source.js'
import { normalizeSource } from './source.js'
import { validateFile } from './validate.js'

/**
 * Fluent builder returned by `ModelMediaHandle.add()`. Configure optional
 * metadata, then call `toCollection()` to run the pipeline: normalize the
 * source, validate it against the collection's rules, persist it to disk +
 * the repository, enforce `singleFile`/`onlyKeepLatest` collection rules,
 * and emit `media:added`.
 */
export class FileAdder {
  private explicitName: string | null = null
  private explicitFileName: string | null = null
  private customProperties: JsonObject = {}
  private manipulations: Record<string, JsonObject> = {}
  private preserveOriginal = false
  private conversionsDisk: string | null = null
  private wantsResponsiveImages = false

  constructor(
    private readonly library: MediaLibrary,
    private readonly modelType: string,
    private readonly modelId: string,
    private readonly source: MediaSource,
  ) {}

  usingName(name: string): this {
    this.explicitName = name
    return this
  }

  usingFileName(fileName: string): this {
    this.explicitFileName = fileName
    return this
  }

  withCustomProperties(props: JsonObject): this {
    this.customProperties = props
    return this
  }

  withManipulations(manipulations: Record<string, JsonObject>): this {
    this.manipulations = manipulations
    return this
  }

  /** Path sources default to MOVE semantics; call this to copy instead. */
  preservingOriginal(): this {
    this.preserveOriginal = true
    return this
  }

  storingConversionsOnDisk(disk: string): this {
    this.conversionsDisk = disk
    return this
  }

  /** Stored on the record; the generation engine arrives in Plan 4. */
  withResponsiveImages(): this {
    this.wantsResponsiveImages = true
    return this
  }

  async toCollection(collectionName: string = 'default'): Promise<MediaRecord> {
    const normalized = await normalizeSource(this.source)
    const collectionDef = this.library.getCollectionDefinition(this.modelType, collectionName)

    const fileName = await this.resolveFileName(normalized)
    const name = this.explicitName ?? basename(fileName, extname(fileName))

    const limits = this.library.limits
    validateFile(
      { fileName, mimeType: normalized.sniffedMime, size: normalized.buffer.length },
      {
        maxFileSize: limits.maxFileSize,
        disallowedExtensions: limits.disallowedExtensions,
        allowedExtensions: limits.allowedExtensions,
        collection: collectionDef,
      },
    )

    const existing = await this.library.repository.findForModel(
      this.modelType,
      this.modelId,
      collectionName,
    )

    const newRecord: NewMediaRecord = {
      id: crypto.randomUUID(),
      uuid: crypto.randomUUID(),
      modelType: this.modelType,
      modelId: this.modelId,
      collectionName,
      name,
      fileName,
      mimeType: normalized.sniffedMime,
      disk: collectionDef.disk ?? this.library.storage.defaultDisk,
      conversionsDisk: this.conversionsDisk ?? collectionDef.conversionsDisk,
      size: normalized.buffer.length,
      manipulations: this.manipulations,
      customProperties: this.customProperties,
      generatedConversions: {},
      responsiveImages: this.wantsResponsiveImages ? { requested: true } : {},
      orderColumn: existing.length + 1,
    }

    const disk = await this.library.storage.disk(newRecord.disk)
    await disk.put(this.library.pathGenerator.path(newRecord as unknown as MediaRecord), normalized.buffer)

    const created = await this.library.repository.create(newRecord)

    // Move semantics: a filesystem-path source is consumed unless the
    // caller opted into preservingOriginal() (copy semantics).
    if (normalized.sourcePath && !this.preserveOriginal) {
      await unlink(normalized.sourcePath)
    }

    await this.enforceCollectionRules(collectionDef, collectionName, created)

    this.library.events.emit('media:added', { media: created })

    return created
  }

  private async resolveFileName(normalized: NormalizedSource): Promise<string> {
    if (this.explicitFileName) return this.explicitFileName
    if (normalized.originalFileName) {
      return this.library.limits.fileNameSanitizer(normalized.originalFileName)
    }
    const sniffed = await fileTypeFromBuffer(normalized.buffer)
    return sniffed ? `file.${sniffed.ext}` : 'file'
  }

  private async enforceCollectionRules(
    collectionDef: CollectionDefinition,
    collectionName: string,
    created: MediaRecord,
  ): Promise<void> {
    if (collectionDef.singleFile) {
      const siblings = await this.library.repository.findForModel(
        this.modelType,
        this.modelId,
        collectionName,
      )
      for (const record of siblings) {
        if (record.id !== created.id) {
          await this.library.deleteMedia(record)
        }
      }
      return
    }

    if (collectionDef.keepLatest !== null) {
      const siblings = await this.library.repository.findForModel(
        this.modelType,
        this.modelId,
        collectionName,
      )
      // Newest first by createdAt; orderColumn (assigned in creation order)
      // breaks ties when two records land in the same millisecond.
      const newestFirst = [...siblings].sort((a, b) => {
        const diff = b.createdAt.getTime() - a.createdAt.getTime()
        if (diff !== 0) return diff
        return (b.orderColumn ?? 0) - (a.orderColumn ?? 0)
      })
      const stale = newestFirst.slice(collectionDef.keepLatest)
      for (const record of stale) {
        await this.library.deleteMedia(record)
      }
    }
  }
}
