# Contributing to node-media-library

Thanks for your interest in contributing. This document covers everything you need to get a working
checkout, run the test suites, and open a pull request that's easy to review.

## Prerequisites

| Requirement | Version   | Notes                                                                                                   |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------- |
| Node.js     | `>=20`    | 20 and 22 are both tested in CI.                                                                        |
| pnpm        | `10.25.0` | Pinned via the root `packageManager` field. Run `corepack enable` and pnpm will match it automatically. |

This project **requires pnpm**. It's a pnpm workspace, and publishing depends on pnpm-specific
`publishConfig.exports` handling — `npm install` / `npm publish` will not work correctly (see
[Publishing](#publishing)).

### Optional system binaries

Several packages shell out to system binaries instead of bundling native npm dependencies. Their test
suites **skip themselves** when the binary isn't on `PATH`, so you can contribute without installing any
of these — but you won't be exercising those code paths locally.

| Binary      | Needed by                        | macOS                    | Debian/Ubuntu                   |
| ----------- | -------------------------------- | ------------------------ | ------------------------------- |
| `pdftoppm`  | `@node-media-library/pdf`        | `brew install poppler`   | `apt-get install poppler-utils` |
| `ffmpeg`    | `@node-media-library/video`      | `brew install ffmpeg`    | `apt-get install ffmpeg`        |
| `jpegoptim` | `@node-media-library/optimizers` | `brew install jpegoptim` | `apt-get install jpegoptim`     |
| `pngquant`  | `@node-media-library/optimizers` | `brew install pngquant`  | `apt-get install pngquant`      |

`@node-media-library/bullmq`'s integration suite is gated on a `REDIS_URL` environment variable rather
than a binary:

```bash
REDIS_URL=redis://localhost:6379 pnpm --filter @node-media-library/bullmq test
```

CI installs every binary above and runs a Redis service, so **the gated suites always run for real on
pull requests** even when they skip on your machine. A green local run with skips is expected; let CI be
the authority on those paths.

## Getting started

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
```

## Repository layout

This is a pnpm workspace monorepo. Every package is independently publishable and depends only on
`@node-media-library/core` — never on a sibling adapter.

```
packages/
  core/        Media library engine: storage, collections, conversions,
               responsive images, downloads/zip, CLI, maintenance
  prisma/      MediaRepository adapter + cascading-delete extension
  bullmq/      QueueDriver adapter
  pdf/         pdftoppm-backed ImageGenerator
  video/       ffmpeg-backed ImageGenerator
  optimizers/  jpegoptim/pngquant-backed ImageOptimizers
docs/
  superpowers/specs/   Design spec — the source of truth for intended behavior
  superpowers/plans/   Historical implementation plans (kept for context)
```

## Common commands

Run from the repository root:

```bash
pnpm -r test                  # every package's suite
pnpm -r typecheck             # tsc --noEmit everywhere
pnpm build                    # tsc -p tsconfig.build.json in every package
pnpm lint                     # eslint
pnpm format                   # prettier --write
pnpm format:check             # prettier --check (what CI runs)
```

Formatting is enforced, so run `pnpm format` before committing. Prettier's config lives under the
`prettier` key in the root `package.json` and matches the existing house style — single quotes, no
semicolons, two-space indent, 100 columns.

The repository was formatted in one bulk commit, which would otherwise dominate `git blame`. Skip it
locally with:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

Scope to one package with `--filter`, and pass a substring to target a single test file:

```bash
pnpm --filter @node-media-library/core test
pnpm --filter @node-media-library/core test copy-move
pnpm --filter @node-media-library/prisma test
```

The CLI's bin points at built output (`dist/cli.js`), so exercising it from a checkout requires
`pnpm build` first. `.ts` config modules need a TypeScript loader such as `tsx`.

## Project conventions

These are enforced during review, so they're worth reading before you write code.

### Docs must match shipped behavior

A documentation claim that **over- or under-states** what the code actually does is treated as a defect,
not a nitpick. If your change alters behavior, update the affected README, the design spec, and any
JSDoc in the same pull request. If a feature has a caveat, document the caveat — this codebase
deliberately spells out its own sharp edges (see the "Known limitations" sections and the honesty notes
on `mergeJsonColumn` in `packages/prisma/src/adapter.ts`).

### New repository backends must pass the contract suite

`MediaRepository` implementations are validated by a shared, backend-agnostic contract suite at
`packages/core/src/testing/repository-contract.ts`, exported publicly as
`@node-media-library/core/testing`. Both the in-memory and Prisma backends run against it. If you add a
repository adapter, wire it into that suite rather than writing parallel tests; if you add a repository
method, add its cases to the contract so **every** backend is held to them.

### Tests exercise real behavior

The suites use real files on a real temp filesystem, a real SQLite database (Prisma), and real
subprocess invocations — not mocks of those boundaries. Please keep it that way. Binary-dependent tests
belong behind an availability gate (`describe.runIf(...)`) with an ungated companion test covering the
binary-missing path, following `packages/optimizers/test/optimizers.test.ts`.

### ESM, with explicit extensions

Everything is ESM (`"type": "module"`). Relative imports carry an explicit `.js` suffix even in
TypeScript source (`import { x } from './thing.js'`).

### Security-sensitive surfaces

`packages/core/README.md` has a [Security model](packages/core/README.md#security-model) section
documenting MIME sniffing, the filename sanitizer and extension blocklist, size-limit enforcement, URL
ingestion allowlists, and private-by-default storage. Changes that touch those paths need matching test
coverage and a docs update. Storage stays **private by default** — public visibility is opt-in per
collection.

## Commit messages

This repository uses [Conventional Commits](https://www.conventionalcommits.org/) with a package scope:

```
feat(core): add copyMedia and moveMedia
fix(optimizers): treat pngquant exit 99 as null pass, not a throw
docs(spec): acknowledge per-key lost-update caveat on read-committed SQL
test(core): tighten weak OR assertion in copy-move responsive test
```

Scopes are package names without the `@node-media-library/` prefix; use a comma-separated list for
changes spanning packages (`feat(pdf,video)`), and omit the scope for repo-wide changes (`chore`,
`build`, `docs`).

## Pull requests

Before opening a PR:

- [ ] `pnpm -r typecheck` passes
- [ ] `pnpm -r test` passes (skips for missing binaries/Redis are expected)
- [ ] `pnpm lint` and `pnpm format:check` pass
- [ ] New behavior has tests that would fail without the change
- [ ] Docs, JSDoc, and the design spec reflect the new behavior — including its caveats
- [ ] `pnpm changeset` run for any user-facing change (see [Releases](#releases))
- [ ] Commits follow Conventional Commits

In the PR description, explain **why** the change is needed, not just what it does, and call out any
deviation from the design spec so a reviewer can confirm it's intentional.

Small, focused PRs get reviewed fastest. If you're planning something large or architectural, please
open an issue first so we can agree on the approach before you invest the time.

## Releases

Versioning and changelogs are managed with [Changesets](https://github.com/changesets/changesets).
**If your change affects users of any package, include a changeset in the same PR:**

```bash
pnpm changeset
```

It asks which packages changed and whether the change is a patch, minor, or major, then writes a small
Markdown file under `.changeset/` for you to commit. Write the summary for someone reading the changelog
later, not for the reviewer — it becomes the CHANGELOG entry verbatim.

Skip the changeset only for changes with no user-visible effect: tests, internal refactors, CI, or
repository tooling.

Maintainers cut a release with:

```bash
pnpm version   # consume changesets: bump versions, write CHANGELOG.md files
pnpm release   # pnpm build && changeset publish
```

### Publishing

Publishing goes through **pnpm only**. Each package's `prepack` script
(`scripts/ensure-pnpm-pack.mjs`) deliberately fails under bare `npm publish` / `npm pack`, because npm
ignores `publishConfig.exports` and would ship a tarball whose entry points reference unbuilt `src/`.

## Reporting bugs and security issues

Functional bugs and feature requests go in [GitHub issues](https://github.com/mujtabarumi/node-media-library/issues).

**Security vulnerabilities do not** — please follow [SECURITY.md](SECURITY.md) instead of filing a public
issue.

## Code of conduct

Participation in this project is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).
