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
  dryRun: boolean
}

/** Spaces delete operations to at most `perSecond` per rolling second. */
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
