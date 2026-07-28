import { DEFAULT_SIGNED_URL_EXPIRES_IN, MediaLibraryConfig, ResolvedConfig, resolveConfig } from './config.js'
import { ModelMediaHandle } from './handle.js'
import { TypedEmitter } from './events.js'
import type { MediaEventMap } from './events.js'
import { CollectionDefinition, DEFAULT_COLLECTION } from './definitions/collection.js'
import { UnknownModelError, MediaLibraryError } from './errors.js'
import type { JsonObject, MediaRecord } from './types.js'
import type { ResponsiveImagesEntry } from './responsive/types.js'
import type { MediaRepository } from './repository.js'
import type { ResolvedStorage } from './storage/resolve.js'
import type { PathGenerator } from './storage/path-generator.js'
import type { UrlGenerator } from './storage/url-generator.js'
import { DefaultUrlGenerator } from './storage/url-generator.js'
import { ConversionEngine, RegenerateOptions } from './conversions/engine.js'
import { conversionFileName } from './conversions/naming.js'
import type { QueueDriver } from './queue.js'
import { Readable } from 'node:stream'
import { contentDisposition } from './downloads/response.js'
import { zipEntryName } from './downloads/zip.js'
import type { Disk } from 'flydrive'
import { RESERVED_CONVERSION_NAMES } from './definitions/collection.js'
import { CleanOptions, CleanResult, DeleteRateGate } from './maintenance/clean.js'

export function createMediaLibrary(config: MediaLibraryConfig): MediaLibrary {
  return new MediaLibrary(config)
}

/** Limits/fields FileAdder and ModelMediaHandle need to validate incoming files (Task 11+). */
export interface ResolvedLimits {
  readonly maxFileSize: number
  readonly disallowedExtensions: readonly string[]
  readonly allowedExtensions: readonly string[] | null
  readonly fileNameSanitizer: ResolvedConfig['fileNameSanitizer']
}

export class MediaLibrary {
  readonly events = new TypedEmitter<MediaEventMap>()
  private readonly resolved: ResolvedConfig
  private readonly engine: ConversionEngine
  private readonly urlGeneratorInstance: UrlGenerator

  constructor(config: MediaLibraryConfig) {
    this.resolved = resolveConfig(config)
    this.engine = new ConversionEngine({
      repository: this.resolved.repository,
      storage: this.resolved.storage,
      pathGenerator: this.resolved.pathGenerator,
      events: this.events,
      generators: [...this.resolved.imageGenerators],
      definitionsFor: (modelType, collection) =>
        this.getCollectionDefinition(modelType, collection).conversions,
      collectionFor: (modelType, collection) => this.getCollectionDefinition(modelType, collection),
      widthCalculator: this.resolved.responsiveWidthCalculator,
      responsivePlaceholders: this.resolved.responsivePlaceholders,
    })
    this.resolved.queue.registerProcessor((job) => this.engine.perform(job.mediaId, job.conversionNames))

    // Built here (after `this.engine` exists) rather than reused from
    // `resolveConfig()`'s own default, since the `conversionFileNameFor` dep
    // needs `engine.applicable()` — a circular dependency resolveConfig()
    // alone can't express. A user-supplied `config.urlGenerator` always wins
    // and is used as-is (it may have its own, unrelated conversion logic).
    this.urlGeneratorInstance =
      config.urlGenerator ??
      new DefaultUrlGenerator(this.resolved.storage, this.resolved.pathGenerator, {
        versionUrls: config.versionUrls ?? false,
        signedUrlExpiresIn: config.signedUrlExpiresIn ?? DEFAULT_SIGNED_URL_EXPIRES_IN,
        conversionFileNameFor: (media, name) => {
          const def = this.engine.applicable(media)[name]
          return def ? conversionFileName(media.fileName, name, this.engine.effectiveFormat(media, def)) : null
        },
      })
  }

  /** @internal Consumed by FileAdder (nonQueued conversions) and tests. */
  get queue(): QueueDriver {
    return this.resolved.queue
  }

  /** @internal Consumed by FileAdder to split dispatch into nonQueued/queued names. */
  get conversionEngine(): ConversionEngine {
    return this.engine
  }

  /** Runs `names` (or all applicable) conversions for `mediaId` inline. */
  async performConversions(mediaId: string, names?: string[]): Promise<void> {
    return this.engine.perform(mediaId, names)
  }

  /**
   * Updates `mediaId`'s per-conversion manipulation overrides and dispatches
   * regeneration for the changed conversions through the queue — per spec
   * §8, "changing it triggers regeneration". Always goes through the queue
   * (not inline) regardless of the conversion's own `queued` flag, since
   * this is an explicit, user-triggered update rather than upload dispatch.
   *
   * `manipulations` REPLACES the record's full manipulations map — it is
   * not merged with the existing one. Callers who want to keep prior
   * overrides for other conversions must include them in this call.
   */
  async updateManipulations(
    mediaId: string,
    manipulations: Record<string, JsonObject>,
  ): Promise<MediaRecord> {
    const updated = await this.resolved.repository.update(mediaId, { manipulations })
    await this.resolved.queue.enqueue({ mediaId, conversionNames: Object.keys(manipulations) })
    return updated
  }

  /**
   * Re-enqueues conversion generation across a set of media records.
   * `opts.ids` (when given) selects exactly those records via `findById`,
   * silently skipping any that don't exist; otherwise every record —
   * optionally narrowed to `opts.modelType` — is visited via
   * `repository.iterateAll()`. For each record, the applicable conversion
   * names are further narrowed by `opts.only` (intersection) and, when
   * `opts.onlyMissing` is set, by excluding names already marked `true` in
   * `generatedConversions`. Records left with zero names to regenerate are
   * skipped entirely — nothing is enqueued for them. Returns the number of
   * `queue.enqueue()` calls made (one per record with names left to run),
   * not the number of individual conversions.
   *
   * With the sync queue driver, a record whose enqueued conversions all
   * fail rethrows synchronously from `enqueue()`, which aborts this run
   * mid-iteration — records not yet visited are never dispatched, and the
   * returned `enqueued` count reflects only what was queued before the
   * failure.
   */
  async regenerate(opts: RegenerateOptions = {}): Promise<{ enqueued: number }> {
    let enqueued = 0

    const dispatch = async (record: MediaRecord): Promise<void> => {
      let names = Object.keys(this.engine.applicable(record))
      if (opts.only) {
        const only = new Set(opts.only)
        names = names.filter((name) => only.has(name))
      }
      if (opts.onlyMissing) {
        names = names.filter((name) => record.generatedConversions[name] !== true)
      }

      if (opts.withResponsive && this.engine.wantsOriginalResponsive(record)) {
        const missing = record.responsiveImages['original'] === undefined
        if (!opts.onlyMissing || missing) names.push('original')
      }

      if (names.length === 0) return

      await this.resolved.queue.enqueue({ mediaId: record.id, conversionNames: names })
      enqueued += 1
    }

    if (opts.ids) {
      const records = (
        await Promise.all(opts.ids.map((id) => this.resolved.repository.findById(id)))
      ).filter((record): record is MediaRecord => record !== null)
      for (const record of records) {
        await dispatch(record)
      }
    } else {
      for await (const record of this.resolved.repository.iterateAll({ modelType: opts.modelType })) {
        await dispatch(record)
      }
    }

    return { enqueued }
  }

  /** @internal Consumed by FileAdder/ModelMediaHandle (Task 11+). */
  get repository(): MediaRepository {
    return this.resolved.repository
  }

  /** @internal Consumed by FileAdder/ModelMediaHandle (Task 11+). */
  get storage(): ResolvedStorage {
    return this.resolved.storage
  }

  /** @internal Consumed by FileAdder/ModelMediaHandle (Task 11+). */
  get pathGenerator(): PathGenerator {
    return this.resolved.pathGenerator
  }

  /** @internal Consumed by FileAdder/ModelMediaHandle (Task 11+). */
  get urlGenerator(): UrlGenerator {
    return this.urlGeneratorInstance
  }

  /** @internal Consumed by FileAdder/ModelMediaHandle (Task 11+). */
  get limits(): ResolvedLimits {
    return {
      maxFileSize: this.resolved.maxFileSize,
      disallowedExtensions: this.resolved.disallowedExtensions,
      allowedExtensions: this.resolved.allowedExtensions,
      fileNameSanitizer: this.resolved.fileNameSanitizer,
    }
  }

  for(modelType: string, modelId: string | number): ModelMediaHandle {
    if (!(modelType in this.resolved.models)) {
      throw new UnknownModelError(`Model type "${modelType}" is not registered`)
    }
    return new ModelMediaHandle(modelType, String(modelId), this)
  }

  /** Registered model type names (e.g. `['User', 'Post']`). */
  get modelTypes(): string[] {
    return Object.keys(this.resolved.models)
  }

  getCollectionDefinition(modelType: string, collection: string): CollectionDefinition {
    return this.resolved.models[modelType]?.[collection] ?? DEFAULT_COLLECTION
  }

  /** Resolves `mediaOrId` to a `MediaRecord`, throwing `MediaLibraryError` when a string id doesn't exist. */
  private async requireMedia(mediaOrId: MediaRecord | string): Promise<MediaRecord> {
    const media =
      typeof mediaOrId === 'string' ? await this.resolved.repository.findById(mediaOrId) : mediaOrId
    if (!media) throw new MediaLibraryError('media not found')
    return media
  }

  private responsiveEntry(media: MediaRecord, conversion: string): ResponsiveImagesEntry | null {
    const entry = media.responsiveImages[conversion]
    if (!entry || typeof entry !== 'object') return null
    return entry as unknown as ResponsiveImagesEntry
  }

  /**
   * Public (or, with `opts.signed`, signed) URLs for `conversion`'s stored
   * responsive variants (widest first, mirroring stored order). `[]` when
   * there's no entry, or when the configured `UrlGenerator` doesn't
   * implement the relevant optional member (`responsiveUrl` /
   * `responsiveSignedUrl`) — graceful degradation for custom generators
   * predating responsive images or signed responsive URLs.
   */
  async responsiveUrls(
    mediaOrId: MediaRecord | string,
    conversion = 'original',
    opts?: { signed?: boolean; expiresIn?: string | number },
  ): Promise<string[]> {
    const media = await this.requireMedia(mediaOrId)
    const entry = this.responsiveEntry(media, conversion)
    if (!entry?.files?.length) return []

    if (opts?.signed) {
      if (!this.urlGeneratorInstance.responsiveSignedUrl) return []
      return Promise.all(
        entry.files.map((f) =>
          this.urlGeneratorInstance.responsiveSignedUrl!(media, f.fileName, { expiresIn: opts.expiresIn }),
        ),
      )
    }

    if (!this.urlGeneratorInstance.responsiveUrl) return []
    return Promise.all(entry.files.map((f) => this.urlGeneratorInstance.responsiveUrl!(media, f.fileName)))
  }

  /** `'url1 800w, url2 669w'` srcset string; `null` when there's no entry/empty files. */
  async srcset(
    mediaOrId: MediaRecord | string,
    conversion = 'original',
    opts?: { signed?: boolean; expiresIn?: string | number },
  ): Promise<string | null> {
    const media = await this.requireMedia(mediaOrId)
    const entry = this.responsiveEntry(media, conversion)
    if (!entry?.files?.length) return null

    if (opts?.signed) {
      if (!this.urlGeneratorInstance.responsiveSignedUrl) return null
      const parts = await Promise.all(
        entry.files.map(
          async (f) =>
            `${await this.urlGeneratorInstance.responsiveSignedUrl!(media, f.fileName, { expiresIn: opts.expiresIn })} ${f.width}w`,
        ),
      )
      return parts.join(', ')
    }

    if (!this.urlGeneratorInstance.responsiveUrl) return null
    const parts = await Promise.all(
      entry.files.map(async (f) => `${await this.urlGeneratorInstance.responsiveUrl!(media, f.fileName)} ${f.width}w`),
    )
    return parts.join(', ')
  }

  /** The LQIP base64 SVG data URI for `conversion`, or `null` when absent. */
  async placeholder(mediaOrId: MediaRecord | string, conversion = 'original'): Promise<string | null> {
    const media = await this.requireMedia(mediaOrId)
    return this.responsiveEntry(media, conversion)?.placeholder ?? null
  }

  async deleteMedia(mediaOrId: MediaRecord | string): Promise<void> {
    const media = await this.requireMedia(mediaOrId)

    this.events.emit('media:deleting', { media })
    const disk = await this.resolved.storage.disk(media.disk)
    await disk.deleteAll(this.resolved.pathGenerator.directory(media))
    if (media.conversionsDisk && media.conversionsDisk !== media.disk) {
      const conversionsDisk = await this.resolved.storage.disk(media.conversionsDisk)
      await conversionsDisk.deleteAll(this.resolved.pathGenerator.conversionsPath(media))
    }
    await this.resolved.repository.delete(media.id)
    this.events.emit('media:deleted', { media })
  }

  /**
   * Deletes every record in `collection` (or all collections, when omitted
   * or `'*'`) for the given model and emits `collection:cleared`. This is
   * the shared implementation behind both `MediaLibrary.clearFor()` and
   * `ModelMediaHandle.clear()` — keeping one code path prevents the two
   * from drifting out of sync on the emitted event.
   *
   * `'*'` is the documented "all collections" sentinel (mirroring
   * `ModelMediaHandle.getAll()`), so it must be normalized to `undefined`
   * before reaching `findForModel` — otherwise it's matched literally
   * against `collectionName` and matches nothing.
   */
  async clearFor(modelType: string, modelId: string | number, collection?: string): Promise<void> {
    const id = String(modelId)
    const scoped = collection === undefined || collection === '*' ? undefined : collection
    const records = await this.resolved.repository.findForModel(modelType, id, scoped)
    for (const record of records) {
      await this.deleteMedia(record)
    }
    this.events.emit('collection:cleared', {
      modelType,
      modelId: id,
      collection: collection ?? '*',
    })
  }

  /**
   * Web-standard Response streaming the file from storage — works natively in
   * Hono/Next/Bun/Deno; use toNodeStream() for Express-style servers. A
   * generated conversion streams its derived file; an unknown/ungenerated
   * conversionName gracefully falls back to the original (mirrors url()).
   *
   * The `Response` is constructed with status 200 as soon as `disk.getStream()`
   * resolves — that only opens the read, it doesn't confirm the whole file is
   * readable. If a conversion is marked `generatedConversions[name] === true`
   * but its file is actually missing from storage (e.g. deleted out from
   * under a stale record), the 200 response's body errors when the caller
   * reads it, not up front; there is no way to downgrade to a 404 after the
   * headers are already committed.
   */
  async download(mediaOrId: MediaRecord | string, conversionName?: string): Promise<Response> {
    return this.fileResponse('attachment', mediaOrId, conversionName)
  }

  async inline(mediaOrId: MediaRecord | string, conversionName?: string): Promise<Response> {
    return this.fileResponse('inline', mediaOrId, conversionName)
  }

  private async fileResponse(
    kind: 'attachment' | 'inline',
    mediaOrId: MediaRecord | string,
    conversionName?: string,
  ): Promise<Response> {
    const media = await this.requireMedia(mediaOrId)

    let path = this.resolved.pathGenerator.path(media)
    let diskName = media.disk
    let fileName = media.fileName
    let contentType = media.mimeType
    let contentLength: string | null = String(media.size)

    if (conversionName && media.generatedConversions[conversionName] === true) {
      const def = this.engine.applicable(media)[conversionName]
      if (def) {
        const format = this.engine.effectiveFormat(media, def)
        fileName = conversionFileName(media.fileName, conversionName, format)
        path = `${this.resolved.pathGenerator.conversionsPath(media)}/${fileName}`
        diskName = media.conversionsDisk ?? media.disk
        contentType = format ? `image/${format}` : media.mimeType
        contentLength = null // size of derived files isn't tracked on the record
      }
    }

    const disk = await this.resolved.storage.disk(diskName)
    const stream = await disk.getStream(path)

    const headers = new Headers()
    if (contentType) headers.set('Content-Type', contentType)
    if (contentLength) headers.set('Content-Length', contentLength)
    headers.set('Content-Disposition', contentDisposition(kind, fileName))

    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers })
  }

  /**
   * Streamed ZIP of `items` (records or ids, mixed disks fine) — no temp
   * file; entries stream from storage as the archive streams out. Foldering:
   * a string `customProperties.zipFilenamePrefix` is prepended to that
   * item's entry name, after `sanitizeZipPrefix()` strips leading slashes,
   * backslashes, and `.`/`..` segments (zip-slip hardening — this value is
   * caller-controlled data, not a trusted path). Not for concurrent
   * mutation: items deleted while the archive streams will abort the
   * response stream.
   *
   * Every item is resolved to a `MediaRecord` (and unknown ids fail fast)
   * BEFORE streaming starts, but no storage read is opened at that point —
   * each entry's `disk.getStream()` call is deferred until archiver actually
   * reads that entry. This avoids opening every source file up front (which
   * can exhaust file descriptors for large archives, or idle out an S3
   * connection for an entry that won't be read for a while) and means an
   * item that's never reached (e.g. the archive/response is aborted early)
   * never opens a storage stream at all. A lazy source's error (missing
   * file, disk failure, etc.) surfaces as that entry stream's error, which
   * propagates to the archive and then to the Response body.
   */
  async zip(archiveName: string, items: Array<MediaRecord | string>): Promise<Response> {
    const archiver = (await import('archiver')).default
    // Resolve every item to a MediaRecord (and fail fast on unknown ids)
    // BEFORE streaming starts — this is metadata-only, no storage read.
    const records = await Promise.all(items.map((item) => this.requireMedia(item)))

    const archive = archiver('zip')
    const taken = new Set<string>()
    for (const media of records) {
      const prefix =
        typeof media.customProperties['zipFilenamePrefix'] === 'string'
          ? (media.customProperties['zipFilenamePrefix'] as string)
          : ''
      const path = this.resolved.pathGenerator.path(media)
      const diskName = media.disk
      const storage = this.resolved.storage
      // Async generator body doesn't run until Readable.from's consumer
      // (archiver) actually pulls from this entry — disk.getStream() is
      // NOT called at append() time.
      async function* lazySource(): AsyncGenerator<Buffer> {
        const disk = await storage.disk(diskName)
        const stream = await disk.getStream(path)
        for await (const chunk of stream) {
          yield chunk as Buffer
        }
      }
      archive.append(Readable.from(lazySource()), { name: zipEntryName(media.fileName, prefix, taken) })
    }
    // finalize() resolves when the archive finishes writing; it must not be
    // awaited here (the consumer hasn't started reading yet — awaiting would
    // deadlock on backpressure for large archives). Failures surface by
    // destroying the archive stream, which errors the Response body.
    archive.finalize().catch((err: unknown) => archive.destroy(err instanceof Error ? err : new Error(String(err))))

    const headers = new Headers({
      'Content-Type': 'application/zip',
      'Content-Disposition': contentDisposition('attachment', archiveName),
    })
    return new Response(Readable.toWeb(archive) as ReadableStream, { status: 200, headers })
  }

  /**
   * `{ key, name }` for every file directly under `dir` on `disk` — `key` is
   * the full, driver-native object key (safe to pass straight to
   * `disk.delete()`); `name` is just the basename, for comparing against
   * expected-file-name sets. `[]` on any listing failure (missing dir,
   * unsupported driver, etc).
   *
   * Deliberately does NOT rely on `disk.listAll(dir, ...)` implicitly
   * scoping to `dir` — flydrive's S3 driver (1.3.x) does a raw prefix match
   * with no trailing slash, so listing `"abc/conversions"` also matches a
   * sibling key like `"abc/conversions-notes.txt"`. This filters results to
   * keys that actually start with `${dir}/`, and further to DIRECT children
   * of `dir` (no additional `/` after that prefix) — a conversions/
   * responsive directory is expected to be flat, so anything deeper is
   * either a foreign object or not ours to touch.
   *
   * Loops on `paginationToken` when the driver returns one, so listings
   * spanning multiple pages (S3) are fully diffed rather than only the
   * first page. The `fs` driver returns everything in a single call with no
   * token, so this runs its body exactly once for it.
   */
  private async listDirectChildren(disk: Disk, dir: string): Promise<Array<{ key: string; name: string }>> {
    const prefix = `${dir}/`
    const results: Array<{ key: string; name: string }> = []
    try {
      let paginationToken: string | undefined
      do {
        const page = await disk.listAll(dir, { recursive: true, paginationToken })
        for (const object of page.objects) {
          if (!object.isFile) continue
          if (!object.key.startsWith(prefix)) continue
          if (object.key.slice(prefix.length).includes('/')) continue
          results.push({ key: object.key, name: object.name })
        }
        paginationToken = page.paginationToken
      } while (paginationToken)
      return results
    } catch {
      return []
    }
  }

  /** `resolved.models[modelType][collection]` presence — the raw registration, not `getCollectionDefinition()`'s zero-conversion fallback. */
  private isRegistered(modelType: string, collection: string): boolean {
    const collections = this.resolved.models[modelType]
    return collections !== undefined && collection in collections
  }

  /** Whether any configured `imageGenerator` claims to support `mimeType`. */
  private hasGeneratorFor(mimeType: string | null): boolean {
    return this.resolved.imageGenerators.some((g) => g.supports(mimeType))
  }

  /**
   * Offline maintenance operation: removes orphaned media (when
   * `opts.deleteOrphaned`), deletes derived files (conversions + responsive
   * variants) that no longer match the current collection/conversion
   * config, and prunes the corresponding stale `generatedConversions` /
   * `responsiveImages` keys. `opts.dryRun` counts everything a real run
   * would do without deleting or updating anything; `opts.rateLimit` spaces
   * out actual delete operations (files and orphaned-media deletes) to at
   * most that many per second — it gates storage deletes only, not the
   * repository update that prunes stale JSON keys.
   *
   * A record is SKIPPED entirely for staleness checks (its files and JSON
   * are left untouched, counted in `result.skippedUnregistered`, and warned
   * about once via `console.warn`) when this config can't be trusted to
   * describe what's actually on disk for it: either its modelType/collection
   * isn't registered here (`getCollectionDefinition()`'s zero-conversion
   * fallback would otherwise make every existing conversion file/key look
   * stale), or it has generated conversions but no configured
   * `imageGenerator` supports its mimeType (which breaks
   * `effectiveFormat()`'s extension guess). `opts.deleteOrphaned` still
   * applies to these records — `repository.ownerExists` is independent of
   * config registration.
   *
   * NOT safe to run concurrently with active conversion workers — a worker
   * writing a conversion's file/JSON for a record while `clean()` is
   * diffing that same record can result in either a spurious deletion or a
   * missed one. Run this offline (e.g. a scheduled job with no in-flight
   * uploads/conversions).
   */
  async clean(opts: CleanOptions = {}): Promise<CleanResult> {
    const dryRun = opts.dryRun ?? false
    const gate = new DeleteRateGate(opts.rateLimit)
    const result: CleanResult = {
      orphanedMediaDeleted: 0,
      staleFilesDeleted: 0,
      staleEntriesRemoved: 0,
      skippedUnregistered: 0,
      dryRun,
    }

    for await (const record of this.resolved.repository.iterateAll()) {
      if (opts.deleteOrphaned && !(await this.resolved.repository.ownerExists(record.modelType, record.modelId))) {
        result.orphanedMediaDeleted += 1
        if (!dryRun) {
          await gate.wait()
          await this.deleteMedia(record)
        }
        continue
      }

      if (!this.isRegistered(record.modelType, record.collectionName)) {
        result.skippedUnregistered += 1
        console.warn(
          `[media-library] clean(): skipping media "${record.id}" — modelType "${record.modelType}" / ` +
            `collection "${record.collectionName}" is not registered in this config, so its expected ` +
            `conversions can't be determined. Its derived files and JSON were left untouched. If this is ` +
            `unexpected, run clean() with a config that registers the same models/collections used at ` +
            `upload time.`,
        )
        continue
      }

      const hasGeneratedConversions = Object.values(record.generatedConversions).some((v) => v === true)
      if (hasGeneratedConversions && !this.hasGeneratorFor(record.mimeType)) {
        result.skippedUnregistered += 1
        console.warn(
          `[media-library] clean(): skipping media "${record.id}" — it has generated conversions but no ` +
            `configured imageGenerator supports mimeType "${record.mimeType}", so the expected on-disk ` +
            `file names/extensions can't be determined. Its derived files and JSON were left untouched. ` +
            `Register the generator that produced them (e.g. pdfImageGenerator()/videoImageGenerator()) ` +
            `before running clean().`,
        )
        continue
      }

      const applicable = this.engine.applicable(record)

      // --- Stale conversion files -------------------------------------
      const expectedConversionFiles = new Set<string>()
      for (const [name, def] of Object.entries(applicable)) {
        expectedConversionFiles.add(conversionFileName(record.fileName, name, this.engine.effectiveFormat(record, def)))
      }

      const conversionsDisk = await this.resolved.storage.disk(record.conversionsDisk ?? record.disk)
      const conversionsDir = this.resolved.pathGenerator.conversionsPath(record)
      for (const { key, name } of await this.listDirectChildren(conversionsDisk, conversionsDir)) {
        if (expectedConversionFiles.has(name)) continue
        result.staleFilesDeleted += 1
        if (!dryRun) {
          await gate.wait()
          await conversionsDisk.delete(key)
        }
      }

      // --- Stale responsive files --------------------------------------
      const expectedResponsiveFiles = new Set<string>()
      for (const [key, value] of Object.entries(record.responsiveImages)) {
        if (key !== 'original' && !(key in applicable)) continue
        const entry = value as ResponsiveImagesEntry | undefined
        for (const file of entry?.files ?? []) {
          expectedResponsiveFiles.add(file.fileName)
        }
      }

      const disk = await this.resolved.storage.disk(record.disk)
      const responsiveDir = this.resolved.pathGenerator.responsivePath(record)
      for (const { key, name } of await this.listDirectChildren(disk, responsiveDir)) {
        if (expectedResponsiveFiles.has(name)) continue
        result.staleFilesDeleted += 1
        if (!dryRun) {
          await gate.wait()
          await disk.delete(key)
        }
      }

      // --- Stale JSON keys -----------------------------------------------
      const generatedConversions: Record<string, boolean> = {}
      let removedKeys = 0
      for (const [name, generated] of Object.entries(record.generatedConversions)) {
        if (name in applicable) {
          generatedConversions[name] = generated
        } else {
          removedKeys += 1
        }
      }

      const responsiveImages: JsonObject = {}
      for (const [key, value] of Object.entries(record.responsiveImages)) {
        if (RESERVED_CONVERSION_NAMES.includes(key) || key in applicable) {
          responsiveImages[key] = value
        } else {
          removedKeys += 1
        }
      }

      if (removedKeys > 0) {
        result.staleEntriesRemoved += removedKeys
        if (!dryRun) {
          await this.resolved.repository.update(record.id, { generatedConversions, responsiveImages })
        }
      }
    }

    return result
  }
}
