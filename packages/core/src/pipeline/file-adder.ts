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

  /**
   * Stored on the record as the `requested` flag. `dispatchConversions()`
   * checks `conversionEngine.wantsOriginalResponsive()` (collection-level
   * `withResponsiveImages()` OR this per-add flag) and, when true, queues
   * `'original'` responsive generation for the media.
   */
  withResponsiveImages(): this {
    this.wantsResponsiveImages = true
    return this
  }

  async toCollection(collectionName: string = 'default'): Promise<MediaRecord> {
    const limits = this.library.limits
    const normalized = await normalizeSource(this.source, { maxBytes: limits.maxFileSize })
    const collectionDef = this.library.getCollectionDefinition(this.modelType, collectionName)

    const fileName = await this.resolveFileName(normalized)
    const name = this.explicitName ?? basename(fileName, extname(fileName))

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

    let created: MediaRecord
    try {
      created = await this.library.repository.create(newRecord)
    } catch (err) {
      // The file already landed on disk before repository.create ran; if the
      // repository write fails, roll back the stored file rather than
      // leaving an orphan with no corresponding record.
      await disk.deleteAll(this.library.pathGenerator.directory(newRecord as unknown as MediaRecord))
      throw err
    }

    // Move semantics: a filesystem-path source is consumed unless the
    // caller opted into preservingOriginal() (copy semantics). This is a
    // local temp-file cleanup, not a data-integrity step: the media record
    // already exists, so a failure here must not fail the whole operation
    // or leave the caller thinking the add() didn't happen (they'd retry
    // and duplicate the media).
    if (normalized.sourcePath && !this.preserveOriginal) {
      try {
        await unlink(normalized.sourcePath)
      } catch (err) {
        console.warn(
          `[media-library] Failed to remove source file "${normalized.sourcePath}" after moving it into the media library:`,
          err,
        )
      }
    }

    await this.enforceCollectionRules(collectionDef, collectionName, created)

    this.library.events.emit('media:added', { media: created })

    await this.dispatchConversions(created)

    return created
  }

  /**
   * Splits the collection-filtered, manipulation-merged conversion
   * definitions (from `engine.applicable()`) into nonQueued (run inline,
   * errors propagate to the caller of `toCollection()`) and queued (handed
   * to the configured `QueueDriver`, which decides when/how they run). A
   * collection with no applicable conversions makes no calls at all.
   *
   * Ordering and failure semantics: queued conversions are enqueued FIRST,
   * before any inline (nonQueued) conversion runs. This guarantees that,
   * since the record already exists (created + `media:added` already
   * emitted by the time this method runs), the queued work is always
   * scheduled once the media record is persisted — a failing nonQueued
   * conversion below can no longer prevent it. If a nonQueued conversion
   * then fails, `performConversions()`'s rejection propagates out of this
   * method and out of `toCollection()`, but the record still persists and
   * the queued conversions remain scheduled (or, with the default
   * `syncDriver`, have already run synchronously during the `enqueue()`
   * await above — there is no rollback of that work on the later inline
   * failure).
   */
  private async dispatchConversions(record: MediaRecord): Promise<void> {
    const applicable = this.library.conversionEngine.applicable(record)

    const nonQueuedNames: string[] = []
    const queuedNames: string[] = []
    for (const [name, def] of Object.entries(applicable)) {
      if (def.queued === false) {
        nonQueuedNames.push(name)
      } else {
        queuedNames.push(name)
      }
    }

    if (this.library.conversionEngine.wantsOriginalResponsive(record)) {
      queuedNames.push('original')
    }

    if (queuedNames.length > 0) {
      await this.library.queue.enqueue({ mediaId: record.id, conversionNames: queuedNames })
    }

    if (nonQueuedNames.length > 0) {
      await this.library.performConversions(record.id, nonQueuedNames)
    }
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
