# CLAUDE.md

Node port of `spatie/laravel-medialibrary`. pnpm workspace monorepo; every package is independently
publishable and depends only on `@node-media-library/core` — never on a sibling adapter.

[CONTRIBUTING.md](CONTRIBUTING.md) is the human-facing guide and stays authoritative. This file covers
what's easy to get wrong from inside the code.

## Commands

```bash
pnpm install                                   # pnpm only — npm will not work (see Publishing)
pnpm -r typecheck                              # tsc --noEmit everywhere
pnpm -r test                                   # every package's vitest suite
pnpm format                                    # prettier --write (CI gates on format:check)
pnpm --filter @node-media-library/core test    # scope to one package
pnpm --filter @node-media-library/core test copy-move   # substring-match a single test file
```

The CLI's `bin` points at built output (`dist/cli.js`), so exercising it from a checkout needs
`pnpm build` first.

## Layout

```
packages/
  core/        engine: storage, collections, conversions, responsive images, downloads/zip, CLI
  prisma/      MediaRepository adapter + cascading-delete extension
  bullmq/      QueueDriver adapter
  pdf/         pdftoppm-backed ImageGenerator
  video/       ffmpeg-backed ImageGenerator
  optimizers/  jpegoptim/pngquant-backed ImageOptimizers
docs/superpowers/specs/   design spec — source of truth for intended behavior
docs/superpowers/plans/   historical plans, kept verbatim (prettier-ignored)
```

Tests live in each package's `test/` directory, **not** colocated in `src/`.

## Conventions

**ESM with explicit extensions.** Everything is `"type": "module"`. Relative imports carry a `.js`
suffix even in TypeScript source: `import { x } from './thing.js'`.

**Formatting.** Prettier config lives under the `prettier` key in the root `package.json` — no
semicolons, single quotes, 2-space indent, 100 columns. Note `.prettierignore` excludes
`**/package.json` (hand-formatted with compact single-line objects) and `docs/superpowers/plans` —
don't reformat either.

**Dual export maps.** Each package declares `exports` pointing at `src/*.ts` for local development
_and_ a `publishConfig.exports` override pointing at `dist/*.js` + `dist/*.d.ts` for the published
tarball. Adding an entry point means updating **both**, or the published package resolves to
TypeScript source consumers can't load. `packages/core` has two entries (`.` and `./testing`).

**Binary-gated tests.** `pdftoppm`, `ffmpeg`, `jpegoptim`, and `pngquant` are optional locally; their
suites gate on availability with `describe.runIf(...)` and pair with an ungated companion test
covering the binary-missing path. Follow `packages/optimizers/test/optimizers.test.ts`. BullMQ's
suite gates on `REDIS_URL` instead. Local skips are expected — CI installs everything and runs them
for real, so let CI be the authority on those paths.

**Tests hit real boundaries.** Real temp files, a real SQLite database, real subprocess invocations —
not mocks of those seams. Keep it that way.

**Repository backends must pass the shared contract.** `MediaRepository` implementations are
validated by `packages/core/src/testing/repository-contract.ts`, exported as
`@node-media-library/core/testing`. Adding a backend means wiring it into that suite, not writing
parallel tests; adding a repository method means adding its cases to the contract so every backend is
held to them.

**Pinned deps.** `flydrive` stays on `^1` (2.x needs Node ≥24; this project supports ≥20) and
`@types/node` stays on `^20` (types track the _minimum_ supported runtime). `.github/dependabot.yml`
ignores majors for both. Every package declares `@types/node` itself rather than relying on pnpm
hoisting.

**Docs must match shipped behavior.** A README, spec, or JSDoc claim that over- or under-states what
the code does is treated as a defect, not a nitpick. Behavior changes update the affected docs in the
same PR — including caveats. This codebase deliberately spells out its own sharp edges (see the
"Known limitations" sections and the honesty notes on `mergeJsonColumn` in
`packages/prisma/src/adapter.ts`).

**Security-sensitive paths.** MIME sniffing, filename sanitization, the extension blocklist, size
limits, URL-ingestion allowlists — documented in `packages/core/README.md` under "Security model".
Changes there need matching tests and a docs update. Storage is **private by default**; public
visibility is opt-in per collection.

## Commits and releases

Conventional Commits with a package scope, minus the `@node-media-library/` prefix:

```
feat(core): add copyMedia and moveMedia
fix(optimizers): treat pngquant exit 99 as null pass, not a throw
feat(pdf,video): ...        # comma-separated for multi-package changes
chore: ...                  # no scope for repo-wide changes
```

Run `pnpm changeset` for any user-facing change. Skip it only for tests, internal refactors, CI, or
tooling.

**Publishing goes through pnpm only.** Each package's `prepack` (`scripts/ensure-pnpm-pack.mjs`)
deliberately fails under bare `npm publish` / `npm pack`, because npm ignores `publishConfig.exports`
and would ship a tarball whose entry points reference unbuilt `src/`.

## Known gap

`pnpm lint` currently fails: ESLint 10 and `typescript-eslint` are in `devDependencies` and the
script exists, but no `eslint.config.js` has been written yet, and CI doesn't run lint. Delete this
section once that's fixed.
