---
title: CLI
description: regenerate, clean, and worker — backfilling conversions, removing stale files, and consuming a broker queue, from the command line or in code.
---

Three commands. `regenerate` and `clean` are also available as methods on `MediaLibrary`; `worker` is a
thin wrapper around `MediaLibrary.startWorker()`. They exist for the operations that act across many
records at once — or, for `worker`, run indefinitely — rather than fitting neatly into a single request:
backfilling a conversion you just added, removing files that config changes have orphaned, and consuming
conversion jobs from a broker.

## Pointing it at your library

Every command needs a config module that **default-exports a `MediaLibrary` instance**. Point `--config`
at it explicitly:

```ts title="media.config.mjs"
import { createMediaLibrary } from '@node-media-library/core'

export default createMediaLibrary({/* the same config your app uses */})
```

```bash
node-media-library regenerate --config media.config.mjs
```

...or omit `--config` and let the CLI resolve `medialibrary.config.{ts,mts,js,mjs}` from the current
directory instead — the same convention `vitest.config.ts`/`drizzle.config.ts` use:

```bash
node-media-library regenerate   # resolves ./medialibrary.config.{ts,mts,js,mjs}
```

The module is loaded with a plain dynamic `import()`, so a `.ts` config needs a TypeScript loader:

```bash
node --import tsx ./node_modules/.bin/node-media-library regenerate --config media.config.ts
```

Running from a checkout of this repository rather than an installed package needs `pnpm build` first —
the bin points at `dist/cli.js`, which the build produces.

Give it your **full** config, not a trimmed-down one. All three commands reason about what _should_
exist (or, for `worker`, run the actual conversion pipeline) by reading your model and collection
definitions; a partial config makes real files look unexpected.

## `regenerate`

Re-dispatches conversion generation for existing media.

```bash
node-media-library regenerate --config <path> [options]
```

| Flag                   | Effect                                                  |
| ---------------------- | ------------------------------------------------------- |
| `--model <type>`       | Only media belonging to this model type.                |
| `--ids <id,id,…>`      | Only these media ids. Unknown ids are skipped silently. |
| `--only <name,name,…>` | Only these conversion names.                            |
| `--only-missing`       | Skip conversions already marked generated.              |
| `--with-responsive`    | Also regenerate responsive variants for the original.   |

The common cases:

```bash
# You added a conversion; produce it for everything that predates it
node-media-library regenerate --config media.config.mjs --only-missing

# You changed one conversion's dimensions; redo just that one, everywhere
node-media-library regenerate --config media.config.mjs --only card

# You turned on .withResponsiveImages(); backfill the variant sets
node-media-library regenerate --config media.config.mjs --with-responsive --only-missing
```

Filters compose: `--only` intersects with the record's applicable conversions, then `--only-missing`
removes the already-generated ones. A record left with nothing to do is skipped entirely, so the
reported count is **records enqueued**, not conversions produced.

`--with-responsive` is not gated by `--only`, which reasons about conversion names. Under
`--only-missing` it applies only to records with no `original` responsive entry yet.

In code:

```ts
await library.regenerate({ modelType: 'Product', onlyMissing: true, withResponsive: true })
// → { enqueued: 42 }
```

Work goes through your configured queue. On the default sync driver it runs inline, so the command
doesn't return until everything is done — and a failing conversion aborts the run mid-iteration, with
records not yet visited never dispatched. With BullMQ it returns as soon as the jobs are queued, and
your workers do the work.

## `clean`

Removes orphaned media and derived files that no longer match your configuration.

```bash
node-media-library clean --config <path> [options]
```

| Flag                | Effect                                                 |
| ------------------- | ------------------------------------------------------ |
| `--dry-run`         | Report what would happen; delete and update nothing.   |
| `--delete-orphaned` | Also delete media whose owning model no longer exists. |
| `--rate-limit <n>`  | At most `n` storage deletions per second.              |

Always start with `--dry-run`:

```bash
node-media-library clean --config media.config.mjs --dry-run --delete-orphaned
```

Output counts orphaned media deleted, stale files deleted, stale JSON entries removed, and anything
skipped.

What it considers stale:

- **Conversion files** on disk whose names don't match any currently-applicable conversion.
- **Responsive variants** not listed in the record's `responsiveImages` for a live conversion.
- **JSON keys** in `generatedConversions` and `responsiveImages` naming conversions that no longer
  exist.

`--rate-limit` gates storage deletions only — the repository updates that prune stale JSON keys are not
throttled. Useful when deleting thousands of objects from S3.

`--delete-orphaned` requires the repository to answer `ownerExists`. For the Prisma adapter that means
supplying the `owners` map — see [persistence with Prisma](/production/prisma/).

### What it skips, loudly

A record is left completely untouched, counted, and warned about when this config can't be trusted to
describe it:

- Its `modelType`/`collectionName` isn't registered here — otherwise the zero-conversion fallback would
  make every existing conversion file look stale.
- It has generated conversions but no configured `imageGenerator` supports its MIME type — which breaks
  the expected-filename calculation. Register the `pdf`/`video` generator that produced them before
  cleaning.

`--delete-orphaned` still applies to skipped records, since owner existence doesn't depend on config.

:::danger[Run this offline]
`clean()` diffs on-disk files against config. A worker writing a conversion for a record while
`clean()` is examining that same record can cause either a spurious deletion or a missed one. Run it
with no in-flight uploads or conversions — a scheduled maintenance job, not a live cron alongside busy
workers. [Full detail](/production/limitations/#clean-is-not-concurrency-safe-with-running-workers)
:::

In code:

```ts
const result = await library.clean({ dryRun: true, deleteOrphaned: true, rateLimit: 10 })
```

## `worker`

Consumes conversion jobs from a broker-backed queue driver (`bullmqDriver`, `rabbitmqDriver`) until
`SIGTERM`/`SIGINT`, then drains in-flight jobs before exiting.

```bash
node-media-library worker --config <path> [--concurrency <n>] [--shutdown-timeout <seconds>]
```

| Flag                     | Effect                                                         |
| ------------------------ | -------------------------------------------------------------- |
| `--concurrency <n>`      | Max jobs processed at once. Driver default applies if omitted. |
| `--shutdown-timeout <s>` | Seconds to wait for in-flight jobs on shutdown. Default `30`.  |

On `SIGTERM`/`SIGINT` it stops accepting new jobs and waits for in-flight ones to finish. If they
haven't settled within `--shutdown-timeout` seconds, it logs the timeout and attempts a forced close.
Whether that bounds shutdown depends on the driver: with `rabbitmqDriver` the forced close cuts the
drain short and abandons the in-flight jobs, so shutdown stays bounded. With `bullmqDriver` it does
not — BullMQ's own `Worker.close()` memoizes its close promise on the first call, so the later forced
call just returns the graceful close already in progress, and the process keeps waiting for those jobs
regardless of `--shutdown-timeout`. Set the timeout below whatever grace period your process manager
gives you before `SIGKILL` either way; that's the only backstop `bullmqDriver` gets.

It exits `1` if the configured driver has no `work()` — an in-process driver (`syncDriver()`,
`deferDriver()`) runs conversions inline and has no separate worker to start.

In code, this is `MediaLibrary.startWorker(opts?)`:

```ts
const worker = await library.startWorker({ concurrency: 4 })
process.on('SIGTERM', () => worker.close()) // { force: true } to abandon in-flight jobs instead
```

Constructing a `MediaLibrary` with a broker driver never starts consuming on its own — `startWorker()`
(or this command) is what does. See [background conversions](/guides/background-conversions/) for the
full picture, including why that split exists and how to share one config between a web process and a
worker.

## Exit codes

`0` on success, `1` on any failure — bad flags, a config that doesn't default-export a library, or an
error during the run. Errors print a clean message rather than an unhandled-rejection stack, so it's
safe to run from cron with output captured.

Flags are validated per command: passing `--rate-limit` to `regenerate` is an error rather than being
silently ignored.
