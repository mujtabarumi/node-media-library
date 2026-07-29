import { describe, it, expect } from 'vitest'
import { runCli } from '../src/cli/run.js'
import type { CliDeps, CliLibrary } from '../src/cli/run.js'
import type { RegenerateOptions } from '../src/conversions/engine.js'
import type { CleanOptions, CleanResult } from '../src/maintenance/clean.js'

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
