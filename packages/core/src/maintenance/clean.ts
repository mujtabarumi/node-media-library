/** Options for `MediaLibrary.clean()`. */
export interface CleanOptions {
  /** Count everything a real run would do, but perform no deletion/update. */
  dryRun?: boolean
  /** Delete media whose owning model no longer exists (per `repository.ownerExists`). */
  deleteOrphaned?: boolean
  /** Max deletions per second across files+records; undefined = unthrottled. */
  rateLimit?: number
}

/** Summary counters returned by `MediaLibrary.clean()`. */
export interface CleanResult {
  orphanedMediaDeleted: number
  staleFilesDeleted: number
  staleEntriesRemoved: number
  /**
   * Total records skipped entirely for staleness checks (files + JSON left
   * untouched) because either (a) their modelType/collection isn't
   * registered in the config `clean()` was run with, or (b) they have
   * generated conversions but no configured `imageGenerator` supports their
   * mimeType. Both cases mean `applicable()`/`effectiveFormat()` can't be
   * trusted to describe what's actually on disk, so treating their existing
   * derived files as stale would delete real, still-referenced files. Does
   * NOT include orphaned-media deletions (`orphanedMediaDeleted`), which are
   * driven by `repository.ownerExists` and unaffected by config
   * registration. Equal to `skippedUnregisteredTargets + skippedWithoutGenerator`.
   */
  skippedUnregistered: number
  /** Skipped: record's modelType/collection isn't registered in this config. */
  skippedUnregisteredTargets: number
  /** Skipped: record has generated conversions but no registered imageGenerator supports its mimeType. */
  skippedWithoutGenerator: number
  dryRun: boolean
}

/**
 * Spaces delete operations to at most `perSecond` per rolling second.
 * @internal
 */
export class DeleteRateGate {
  private lastAt = 0
  constructor(private readonly perSecond: number | undefined) {}

  async wait(): Promise<void> {
    if (!this.perSecond) return
    const interval = 1000 / this.perSecond
    const now = Date.now()
    const earliest = this.lastAt + interval
    if (now < earliest) {
      await new Promise((resolve) => setTimeout(resolve, earliest - now))
    }
    this.lastAt = Date.now()
  }
}
