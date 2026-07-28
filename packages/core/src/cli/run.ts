import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { MediaLibraryError } from '../errors.js'
import type { RegenerateOptions } from '../conversions/engine.js'
import type { CleanOptions, CleanResult } from '../maintenance/clean.js'

/** Duck-typed subset of `MediaLibrary` the CLI needs — no `instanceof` checks. */
export interface CliLibrary {
  regenerate(opts: RegenerateOptions): Promise<{ enqueued: number }>
  clean(opts?: CleanOptions): Promise<CleanResult>
}

export interface CliDeps {
  loadLibrary(configPath: string): Promise<CliLibrary>
  log(line: string): void
  error(line: string): void
}

const USAGE = `Usage: node-media-library <command> --config <path> [options]

Commands:
  regenerate --config <path> [--model <type>] [--ids <id,id,...>] [--only <name,name,...>] [--only-missing] [--with-responsive]
      Regenerate conversions (and optionally responsive images) for existing media.

  clean --config <path> [--dry-run] [--delete-orphaned] [--rate-limit <n>]
      Delete orphaned media and stale conversion files.

Options:
  --config <path>          Path to a module that default-exports a MediaLibrary instance (required)
  --model <type>            regenerate: restrict to this model type
  --ids <id,id,...>         regenerate: restrict to these media ids
  --only <name,name,...>    regenerate: restrict to these conversion names
  --only-missing             regenerate: only regenerate conversions that are missing
  --with-responsive          regenerate: also regenerate responsive images
  --dry-run                  clean: report what would happen without deleting anything
  --delete-orphaned          clean: delete media whose owning model no longer exists
  --rate-limit <n>           clean: max deletions per second
`

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

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
  }

  if (command !== 'regenerate' && command !== 'clean') {
    deps.error(`Unknown command: ${command ?? '(none)'}`)
    deps.error(USAGE)
    return 1
  }

  if (!values.config) {
    deps.error('Missing required --config <path>.')
    deps.error(USAGE)
    return 1
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
    library = await deps.loadLibrary(values.config)
  } catch (err) {
    deps.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  try {
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
      deps.log(`${prefix}Skipped (unregistered model/collection/generator): ${result.skippedUnregistered}`)
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
 */
export async function defaultLoadLibrary(configPath: string): Promise<CliLibrary> {
  const url = pathToFileURL(resolve(configPath)).href
  const mod = (await import(url)) as { default?: unknown }
  const candidate = mod?.default as Partial<CliLibrary> | undefined

  if (!candidate || typeof candidate.regenerate !== 'function' || typeof candidate.clean !== 'function') {
    const tsHint = configPath.endsWith('.ts')
      ? ' `.ts` configs must be executed with a TypeScript loader such as `tsx` (e.g. `tsx ./dist/cli.js ...` or `node --import tsx ...`).'
      : ''
    throw new MediaLibraryError(
      `Config at "${configPath}" must default-export a MediaLibrary instance (an object with regenerate() and clean() methods).${tsHint}`
    )
  }

  return candidate as CliLibrary
}
