import { describe, it, expect } from 'vitest'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCli, resolveConfigPath } from '../src/cli/run.js'
import type { CliDeps, CliLibrary } from '../src/cli/run.js'
import type { RegenerateOptions } from '../src/conversions/engine.js'
import type { CleanOptions, CleanResult } from '../src/maintenance/clean.js'
import { MediaLibraryError } from '../src/errors.js'

interface Recorder {
  configPaths: string[]
  regenerateCalls: RegenerateOptions[]
  cleanCalls: (CleanOptions | undefined)[]
  logs: string[]
  errors: string[]
}

function makeDeps(
  overrides: {
    regenerate?: (opts: RegenerateOptions) => Promise<{ enqueued: number }>
    clean?: (opts?: CleanOptions) => Promise<CleanResult>
    loadLibrary?: (configPath: string) => Promise<CliLibrary>
    startWorker?: CliLibrary['startWorker']
    close?: CliLibrary['close']
  } = {},
): { deps: CliDeps; recorder: Recorder } {
  const recorder: Recorder = {
    configPaths: [],
    regenerateCalls: [],
    cleanCalls: [],
    logs: [],
    errors: [],
  }

  const library: CliLibrary = {
    regenerate: async (opts: RegenerateOptions) => {
      recorder.regenerateCalls.push(opts)
      return overrides.regenerate ? overrides.regenerate(opts) : { enqueued: 0 }
    },
    clean: async (opts?: CleanOptions) => {
      recorder.cleanCalls.push(opts)
      return overrides.clean
        ? overrides.clean(opts)
        : {
            orphanedMediaDeleted: 0,
            staleFilesDeleted: 0,
            staleEntriesRemoved: 0,
            skippedUnregistered: 0,
            skippedUnregisteredTargets: 0,
            skippedWithoutGenerator: 0,
            dryRun: false,
          }
    },
    startWorker: async (opts) =>
      overrides.startWorker ? overrides.startWorker(opts) : { close: async () => {} },
    close: async () => (overrides.close ? overrides.close() : undefined),
  }

  const deps: CliDeps = {
    loadLibrary: async (configPath: string) => {
      recorder.configPaths.push(configPath)
      return overrides.loadLibrary ? overrides.loadLibrary(configPath) : library
    },
    log: (line: string) => recorder.logs.push(line),
    error: (line: string) => recorder.errors.push(line),
  }

  return { deps, recorder }
}

describe('runCli', () => {
  it('regenerate command parses flags and forwards them to the library', async () => {
    const { deps, recorder } = makeDeps({ regenerate: async () => ({ enqueued: 3 }) })

    const code = await runCli(
      [
        'regenerate',
        '--config',
        'media.config.mjs',
        '--model',
        'User',
        '--ids',
        'a,b',
        '--only',
        'thumb,preview',
        '--only-missing',
        '--with-responsive',
      ],
      deps,
    )

    expect(code).toBe(0)
    expect(recorder.configPaths).toEqual(['media.config.mjs'])
    expect(recorder.regenerateCalls).toEqual([
      {
        modelType: 'User',
        ids: ['a', 'b'],
        only: ['thumb', 'preview'],
        onlyMissing: true,
        withResponsive: true,
      },
    ])
    expect(recorder.logs.some((l) => l.includes('Enqueued 3'))).toBe(true)
  })

  it('clean command parses flags and prints the result counts', async () => {
    const cleanResult: CleanResult = {
      orphanedMediaDeleted: 2,
      staleFilesDeleted: 5,
      staleEntriesRemoved: 1,
      skippedUnregistered: 0,
      skippedUnregisteredTargets: 0,
      skippedWithoutGenerator: 0,
      dryRun: true,
    }
    const { deps, recorder } = makeDeps({ clean: async () => cleanResult })

    const code = await runCli(
      ['clean', '--config', 'c.mjs', '--dry-run', '--delete-orphaned', '--rate-limit', '10'],
      deps,
    )

    expect(code).toBe(0)
    expect(recorder.cleanCalls).toEqual([{ dryRun: true, deleteOrphaned: true, rateLimit: 10 }])
    expect(recorder.logs.some((l) => l.includes('2'))).toBe(true)
    expect(recorder.logs.some((l) => l.includes('5'))).toBe(true)
    expect(recorder.logs.some((l) => l.includes('1'))).toBe(true)
  })

  it('clean command prints the per-reason skip breakdown when records were skipped', async () => {
    const cleanResult: CleanResult = {
      orphanedMediaDeleted: 0,
      staleFilesDeleted: 0,
      staleEntriesRemoved: 0,
      skippedUnregistered: 3,
      skippedUnregisteredTargets: 2,
      skippedWithoutGenerator: 1,
      dryRun: false,
    }
    const { deps, recorder } = makeDeps({ clean: async () => cleanResult })

    const code = await runCli(['clean', '--config', 'c.mjs'], deps)

    expect(code).toBe(0)
    expect(recorder.logs.some((l) => l.includes('Skipped') && l.includes('3'))).toBe(true)
    expect(
      recorder.logs.some((l) => l.includes('unregistered model/collection') && l.includes('2')),
    ).toBe(true)
    expect(recorder.logs.some((l) => l.includes('no generator for mime') && l.includes('1'))).toBe(
      true,
    )
  })

  it('fails when --config is missing', async () => {
    const { deps, recorder } = makeDeps()

    const code = await runCli(['regenerate'], deps)

    expect(code).toBe(1)
    expect(recorder.errors.some((l) => l.includes('--config'))).toBe(true)
    expect(recorder.configPaths).toEqual([])
  })

  it('fails on an unknown command with usage', async () => {
    const { deps, recorder } = makeDeps()

    const code = await runCli(['frobnicate', '--config', 'c.mjs'], deps)

    expect(code).toBe(1)
    expect(recorder.errors.some((l) => /regenerate/.test(l) && /clean/.test(l))).toBe(true)
    expect(recorder.configPaths).toEqual([])
  })

  it('fails when no command is given, with usage', async () => {
    const { deps, recorder } = makeDeps()

    const code = await runCli([], deps)

    expect(code).toBe(1)
    expect(recorder.errors.some((l) => /regenerate/.test(l) && /clean/.test(l))).toBe(true)
    expect(recorder.configPaths).toEqual([])
  })

  it('fails with a clear message when --rate-limit is not a number', async () => {
    const { deps, recorder } = makeDeps()

    const code = await runCli(['clean', '--config', 'c.mjs', '--rate-limit', 'abc'], deps)

    expect(code).toBe(1)
    expect(recorder.errors.some((l) => l.includes('rate-limit'))).toBe(true)
    expect(recorder.cleanCalls).toEqual([])
  })

  it('fails and surfaces the thrown message when loadLibrary rejects', async () => {
    const { deps, recorder } = makeDeps({
      loadLibrary: async () => {
        throw new Error('config must default-export a MediaLibrary instance')
      },
    })

    const code = await runCli(['regenerate', '--config', 'bad.mjs'], deps)

    expect(code).toBe(1)
    expect(
      recorder.errors.some((l) => l.includes('config must default-export a MediaLibrary instance')),
    ).toBe(true)
  })

  it('fails with a clear message when --rate-limit is 0', async () => {
    const { deps, recorder } = makeDeps()

    const code = await runCli(['clean', '--config', 'c.mjs', '--rate-limit', '0'], deps)

    expect(code).toBe(1)
    expect(recorder.errors.some((l) => l.includes('rate-limit'))).toBe(true)
    expect(recorder.cleanCalls).toEqual([])
  })

  it('fails with a clear message when --rate-limit is negative', async () => {
    const { deps, recorder } = makeDeps()

    const code = await runCli(['clean', '--config', 'c.mjs', '--rate-limit', '-5'], deps)

    expect(code).toBe(1)
    expect(recorder.errors.some((l) => l.includes('rate-limit'))).toBe(true)
    expect(recorder.cleanCalls).toEqual([])
  })

  it('returns 1 and reports the error message when clean() rejects, instead of letting it escape unhandled', async () => {
    const { deps, recorder } = makeDeps({
      clean: async () => {
        throw new Error('repository connection lost')
      },
    })

    const code = await runCli(['clean', '--config', 'c.mjs'], deps)

    expect(code).toBe(1)
    expect(recorder.errors.some((l) => l.includes('repository connection lost'))).toBe(true)
  })

  it('fails with a clear message when a clean-only flag is passed to regenerate', async () => {
    const { deps, recorder } = makeDeps()

    const code = await runCli(['regenerate', '--config', 'c.mjs', '--rate-limit', '5'], deps)

    expect(code).toBe(1)
    expect(
      recorder.errors.some((l) => l.includes('--rate-limit') && l.includes('regenerate')),
    ).toBe(true)
    expect(recorder.regenerateCalls).toEqual([])
    expect(recorder.configPaths).toEqual([])
  })

  it('fails with a clear message when a regenerate-only flag is passed to clean', async () => {
    const { deps, recorder } = makeDeps()

    const code = await runCli(['clean', '--config', 'c.mjs', '--with-responsive'], deps)

    expect(code).toBe(1)
    expect(
      recorder.errors.some((l) => l.includes('--with-responsive') && l.includes('clean')),
    ).toBe(true)
    expect(recorder.cleanCalls).toEqual([])
  })

  it('returns 1 and reports the error message when regenerate() rejects, instead of letting it escape unhandled', async () => {
    const { deps, recorder } = makeDeps({
      regenerate: async () => {
        throw new Error('queue is down')
      },
    })

    const code = await runCli(['regenerate', '--config', 'c.mjs'], deps)

    expect(code).toBe(1)
    expect(recorder.errors.some((l) => l.includes('queue is down'))).toBe(true)
  })
})

describe('worker command', () => {
  it('starts a worker and returns 0 on SIGTERM', async () => {
    let workerClosed = false
    let libraryClosed = false
    const order: string[] = []
    const { deps, recorder } = makeDeps({
      startWorker: async () => ({
        close: async () => {
          workerClosed = true
          order.push('worker')
        },
      }),
      close: async () => {
        libraryClosed = true
        order.push('library')
      },
    })
    const run = runCli(['worker', '--config', './x.js'], deps)
    setImmediate(() => process.emit('SIGTERM'))
    expect(await run).toBe(0)
    expect(workerClosed).toBe(true)
    expect(libraryClosed).toBe(true)
    // Proves the drain-then-close ordering, not just that both eventually
    // ran - e.g. a regression to Promise.all([worker.close(), library.close()])
    // would still leave both flags true but would not preserve this order.
    expect(order).toEqual(['worker', 'library'])
    expect(recorder.logs.join('\n')).toContain('Worker started')
  })

  it('reports a clear error when the driver has no worker', async () => {
    const { deps, recorder } = makeDeps({
      startWorker: async () => {
        throw new MediaLibraryError('configured queue driver is in-process')
      },
    })
    expect(await runCli(['worker', '--config', './x.js'], deps)).toBe(1)
    expect(recorder.errors.join('\n')).toContain('in-process')
  })

  it('rejects --dry-run on the worker command', async () => {
    const { deps } = makeDeps()
    expect(await runCli(['worker', '--config', './x.js', '--dry-run'], deps)).toBe(1)
  })

  it('does not leak SIGTERM/SIGINT listeners on process after finishing', async () => {
    const before = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT')
    const { deps } = makeDeps({ startWorker: async () => ({ close: async () => {} }) })
    const run = runCli(['worker', '--config', './x.js'], deps)
    setImmediate(() => process.emit('SIGTERM'))
    await run
    const after = process.listenerCount('SIGTERM') + process.listenerCount('SIGINT')
    expect(after).toBe(before)
  })

  it('force-closes and reports a timeout when close() does not resolve in time', async () => {
    let forceClosed = false
    const { deps, recorder } = makeDeps({
      startWorker: async () => ({
        close: async (opts?: { force?: boolean }) => {
          if (opts?.force) {
            forceClosed = true
            return
          }
          // Simulate a drain that never finishes on its own.
          await new Promise<void>(() => {})
        },
      }),
    })
    const start = Date.now()
    const run = runCli(['worker', '--config', './x.js', '--shutdown-timeout', '0.05'], deps)
    setImmediate(() => process.emit('SIGTERM'))
    const code = await run
    expect(code).toBe(0)
    expect(forceClosed).toBe(true)
    expect(recorder.errors.join('\n')).toContain('timed out')
    // Proves the CLI doesn't hang for the unresolved close() call once the
    // shutdown-timeout elapses, and that the leftover timer is cleared.
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('does not crash when the abandoned close() rejects after the shutdown timeout already elapsed', async () => {
    let unhandled: unknown
    const onUnhandledRejection = (err: unknown) => {
      unhandled = err
    }
    process.on('unhandledRejection', onUnhandledRejection)

    const { deps, recorder } = makeDeps({
      startWorker: async () => ({
        close: async (opts?: { force?: boolean }) => {
          if (opts?.force) return // the forced close succeeds immediately
          // The un-forced drain rejects well after the 0.05s shutdown-timeout
          // has already fired and lost the race - e.g. the broker connection
          // dropping mid-drain, after we've already moved on to force-close.
          await new Promise((_, reject) => setTimeout(() => reject(new Error('broker gone')), 200))
        },
      }),
    })
    const run = runCli(['worker', '--config', './x.js', '--shutdown-timeout', '0.05'], deps)
    setImmediate(() => process.emit('SIGTERM'))
    const code = await run
    expect(code).toBe(0)
    expect(recorder.errors.join('\n')).toContain('timed out')
    // Give the abandoned close() promise time to reject in the background,
    // proving it doesn't escape as an unhandled rejection once it does.
    await new Promise((r) => setTimeout(r, 300))
    process.off('unhandledRejection', onUnhandledRejection)
    expect(unhandled).toBeUndefined()
  })
})

describe('resolveConfigPath', () => {
  it('returns the explicit path unchanged, without touching the filesystem', () => {
    expect(resolveConfigPath('./somewhere/else.mjs')).toBe('./somewhere/else.mjs')
  })

  it('returns undefined when no explicit path is given and no conventional file exists', () => {
    // realpath'd because process.cwd() (which resolveConfigPath resolves
    // against) reports the real path, while os.tmpdir() on macOS is a
    // symlink (/var/folders/... -> /private/var/folders/...) - without this
    // the two would disagree on a string that is otherwise the same directory.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'nml-cli-config-')))
    const originalCwd = process.cwd()
    try {
      process.chdir(dir)
      expect(resolveConfigPath(undefined)).toBeUndefined()
    } finally {
      process.chdir(originalCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('falls back to a conventional medialibrary.config file in the current directory', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'nml-cli-config-')))
    const originalCwd = process.cwd()
    try {
      const configPath = join(dir, 'medialibrary.config.mjs')
      writeFileSync(configPath, 'export default {}\n')
      process.chdir(dir)
      expect(resolveConfigPath(undefined)).toBe(configPath)
    } finally {
      process.chdir(originalCwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
