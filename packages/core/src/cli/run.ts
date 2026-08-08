import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { MediaLibraryError } from '../errors.js'
import type { RegenerateOptions } from '../conversions/engine.js'
import type { CleanOptions, CleanResult } from '../maintenance/clean.js'

/**
 * Duck-typed subset of `MediaLibrary` the CLI needs — no `instanceof` checks.
 * @internal
 */
export interface CliLibrary {
  regenerate(opts: RegenerateOptions): Promise<{ enqueued: number }>
  clean(opts?: CleanOptions): Promise<CleanResult>
  startWorker(opts?: { concurrency?: number }): Promise<{
    close(opts?: { force?: boolean }): Promise<void>
  }>
  close(): Promise<void>
}

/** @internal */
export interface CliDeps {
  loadLibrary(configPath: string): Promise<CliLibrary>
  log(line: string): void
  error(line: string): void
}

const CONFIG_BASENAMES = [
  'medialibrary.config.ts',
  'medialibrary.config.mts',
  'medialibrary.config.js',
  'medialibrary.config.mjs',
] as const

const USAGE = `Usage: node-media-library <command> --config <path> [options]

Commands:
  regenerate --config <path> [--model <type>] [--ids <id,id,...>] [--only <name,name,...>] [--only-missing] [--with-responsive]
      Regenerate conversions (and optionally responsive images) for existing media.

  clean --config <path> [--dry-run] [--delete-orphaned] [--rate-limit <n>]
      Delete orphaned media and stale conversion files.

  worker --config <path> [--concurrency <n>] [--shutdown-timeout <seconds>]
      Consume conversion jobs from the configured broker driver until SIGTERM/SIGINT.

Options:
  --config <path>          Path to a module that default-exports a MediaLibrary instance
                            (required unless one of ${CONFIG_BASENAMES.join(' / ')} exists in the current directory)
  --model <type>            regenerate: restrict to this model type
  --ids <id,id,...>         regenerate: restrict to these media ids
  --only <name,name,...>    regenerate: restrict to these conversion names
  --only-missing             regenerate: only regenerate conversions that are missing
  --with-responsive          regenerate: also regenerate responsive images
  --dry-run                  clean: report what would happen without deleting anything
  --delete-orphaned          clean: delete media whose owning model no longer exists
  --rate-limit <n>           clean: max deletions per second
  --concurrency <n>          worker: max jobs processed at once
  --shutdown-timeout <s>     worker: seconds to wait for in-flight jobs on shutdown (default 30)
`

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * `parseArgs` declares the union of every command's flags (it has no
 * per-subcommand mode), so a flag valid for one command but typo'd/misused
 * under the other parses without error and is then silently ignored by
 * whichever branch doesn't read it — e.g. `regenerate --rate-limit 5` used
 * to accept the flag and just never apply it. This maps each command to the
 * flags it actually reads, so `runCli` can reject anything outside that set
 * with a clear error instead of accepting-and-ignoring it.
 */
const FLAGS_BY_COMMAND: Record<'regenerate' | 'clean' | 'worker', readonly string[]> = {
  regenerate: ['model', 'ids', 'only', 'only-missing', 'with-responsive'],
  clean: ['dry-run', 'delete-orphaned', 'rate-limit'],
  worker: ['concurrency', 'shutdown-timeout'],
}

/**
 * Resolves the config module path. An explicit `--config` always wins;
 * otherwise the conventional filenames are probed in cwd, matching how
 * vitest/drizzle/playwright resolve theirs.
 * @internal
 */
export function resolveConfigPath(explicit?: string): string | undefined {
  if (explicit) return explicit
  return CONFIG_BASENAMES.map((name) => resolve(name)).find((path) => existsSync(path))
}

/** @internal */
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        config: { type: 'string' },
        model: { type: 'string' },
        ids: { type: 'string' },
        only: { type: 'string' },
        'only-missing': { type: 'boolean' },
        'with-responsive': { type: 'boolean' },
        'dry-run': { type: 'boolean' },
        'delete-orphaned': { type: 'boolean' },
        'rate-limit': { type: 'string' },
        concurrency: { type: 'string' },
        'shutdown-timeout': { type: 'string' },
      },
    })
  } catch (err) {
    deps.error(err instanceof Error ? err.message : String(err))
    deps.error(USAGE)
    return 1
  }

  const [command] = parsed.positionals
  const values = parsed.values as {
    config?: string
    model?: string
    ids?: string
    only?: string
    'only-missing'?: boolean
    'with-responsive'?: boolean
    'dry-run'?: boolean
    'delete-orphaned'?: boolean
    'rate-limit'?: string
    concurrency?: string
    'shutdown-timeout'?: string
  }

  if (command !== 'regenerate' && command !== 'clean' && command !== 'worker') {
    deps.error(`Unknown command: ${command ?? '(none)'}`)
    deps.error(USAGE)
    return 1
  }

  const configPath = resolveConfigPath(values.config)
  if (!configPath) {
    deps.error(
      `Missing --config <path>, and no ${CONFIG_BASENAMES.join(' / ')} found in the current directory.`,
    )
    deps.error(USAGE)
    return 1
  }

  const allowedFlags = FLAGS_BY_COMMAND[command]
  for (const [flag, value] of Object.entries(values)) {
    if (flag === 'config' || value === undefined) continue
    if (!allowedFlags.includes(flag)) {
      deps.error(`--${flag} is not a valid flag for the "${command}" command.`)
      deps.error(USAGE)
      return 1
    }
  }

  let rateLimit: number | undefined
  if (command === 'clean' && values['rate-limit'] !== undefined) {
    rateLimit = Number(values['rate-limit'])
    if (!Number.isFinite(rateLimit) || rateLimit <= 0) {
      deps.error(
        `Invalid --rate-limit value: ${JSON.stringify(values['rate-limit'])} (expected a number greater than 0).`,
      )
      return 1
    }
  }

  let library: CliLibrary
  try {
    library = await deps.loadLibrary(configPath)
  } catch (err) {
    deps.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  try {
    if (command === 'worker') {
      const concurrency = values.concurrency === undefined ? undefined : Number(values.concurrency)
      if (concurrency !== undefined && (!Number.isFinite(concurrency) || concurrency <= 0)) {
        deps.error('--concurrency must be a positive number.')
        return 1
      }
      const timeoutSeconds =
        values['shutdown-timeout'] === undefined ? 30 : Number(values['shutdown-timeout'])
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
        deps.error('--shutdown-timeout must be a positive number.')
        return 1
      }

      const worker = await library.startWorker(
        concurrency === undefined ? undefined : { concurrency },
      )
      deps.log('Worker started. Press Ctrl+C to stop.')

      await new Promise<void>((resolve) => {
        const stop = () => {
          process.off('SIGTERM', stop)
          process.off('SIGINT', stop)
          resolve()
        }
        process.once('SIGTERM', stop)
        process.once('SIGINT', stop)
      })

      deps.log('Shutting down; waiting for in-flight jobs...')
      // Kubernetes SIGKILLs after its grace period, so an unbounded drain is
      // killed mid-job anyway — bound it and report the outcome honestly.
      let timer: ReturnType<typeof setTimeout> | undefined
      const drain = worker.close()
      // Promise.race already keeps `drain`'s rejection handled (it attaches
      // its own reaction to every raced promise, winner or loser), so this
      // catch isn't averting a live crash — it's defensive insurance in case
      // a future refactor stops chaining directly off `drain` here. Kept
      // separate from the raced `.then(() => false)` chain below so a
      // rejection that arrives *before* the timeout still fails the race for
      // real and is reported as an actual error, instead of being silently
      // downgraded to "timed out".
      drain.catch(() => {})
      const timedOut = await Promise.race([
        drain.then(() => false),
        new Promise<boolean>((r) => {
          timer = setTimeout(() => r(true), timeoutSeconds * 1000)
        }),
      ])
      if (timer !== undefined) clearTimeout(timer)
      if (timedOut) {
        deps.error(
          `Shutdown timed out after ${timeoutSeconds}s; attempting a forced close. Some drivers ` +
            'may not honor it and continue waiting on in-flight jobs regardless.',
        )
        await worker.close({ force: true })
      }
      await library.close()
      deps.log('Worker stopped.')
      return 0
    }

    if (command === 'regenerate') {
      const opts: RegenerateOptions = {}
      if (values.model) opts.modelType = values.model
      if (values.ids) opts.ids = splitList(values.ids)
      if (values.only) opts.only = splitList(values.only)
      if (values['only-missing']) opts.onlyMissing = true
      if (values['with-responsive']) opts.withResponsive = true

      const result = await library.regenerate(opts)
      deps.log(`Enqueued ${result.enqueued} regeneration job(s).`)
      return 0
    }

    const cleanOpts: CleanOptions = {}
    if (values['dry-run']) cleanOpts.dryRun = true
    if (values['delete-orphaned']) cleanOpts.deleteOrphaned = true
    if (rateLimit !== undefined) cleanOpts.rateLimit = rateLimit

    const result = await library.clean(cleanOpts)
    const prefix = result.dryRun ? '[dry-run] ' : ''
    deps.log(`${prefix}Orphaned media deleted: ${result.orphanedMediaDeleted}`)
    deps.log(`${prefix}Stale files deleted: ${result.staleFilesDeleted}`)
    deps.log(`${prefix}Stale entries removed: ${result.staleEntriesRemoved}`)
    if (result.skippedUnregistered > 0) {
      deps.log(
        `${prefix}Skipped (unregistered model/collection/generator): ${result.skippedUnregistered}`,
      )
      deps.log(`${prefix}  - unregistered model/collection: ${result.skippedUnregisteredTargets}`)
      deps.log(`${prefix}  - no generator for mime: ${result.skippedWithoutGenerator}`)
    }
    return 0
  } catch (err) {
    // regenerate()/clean() rejections (e.g. sync-queue conversion failures,
    // repository errors) must not escape as a raw unhandled-rejection stack
    // from the bin — report cleanly and exit non-zero instead.
    deps.error(err instanceof Error ? err.message : String(err))
    return 1
  }
}

/**
 * Loads a `MediaLibrary` instance from a config module's default export.
 * `.ts` configs must be run through a TypeScript loader (e.g. `tsx`) since
 * this uses a plain dynamic `import()`.
 * @internal
 */
export async function defaultLoadLibrary(configPath: string): Promise<CliLibrary> {
  const url = pathToFileURL(resolve(configPath)).href
  const mod = (await import(url)) as { default?: unknown }
  const candidate = mod?.default as Partial<CliLibrary> | undefined

  if (
    !candidate ||
    typeof candidate.regenerate !== 'function' ||
    typeof candidate.clean !== 'function'
  ) {
    const tsHint = configPath.endsWith('.ts')
      ? ' `.ts` configs must be executed with a TypeScript loader such as `tsx` (e.g. `tsx ./dist/cli.js ...` or `node --import tsx ...`).'
      : ''
    throw new MediaLibraryError(
      `Config at "${configPath}" must default-export a MediaLibrary instance (an object with regenerate() and clean() methods).${tsHint}`,
    )
  }

  return candidate as CliLibrary
}
