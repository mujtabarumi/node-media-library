# node-media-library

A Node.js port of [spatie/laravel-medialibrary](https://github.com/spatie/laravel-medialibrary): attach one or more files to Eloquent-like models, organize them into collections, generate image/PDF/video conversions and responsive image sets, download or zip them back out, and manage it all from a CLI or programmatically — backed by pluggable storage (via [flydrive](https://flydrive.dev)), a pluggable repository (Prisma adapter included), and a pluggable job queue (BullMQ adapter included).

This is a pnpm workspace monorepo. Each package is independently publishable and depends only on `@node-media-library/core`.

## Packages

| Package | Description |
| --- | --- |
| [`@node-media-library/core`](packages/core/README.md) | Media library engine: storage, collections, conversions, responsive images, downloads/zip, CLI. |
| [`@node-media-library/prisma`](packages/prisma/README.md) | Prisma adapter (`MediaRepository` + cascading deletes) for `@node-media-library/core`. |
| [`@node-media-library/bullmq`](packages/bullmq/README.md) | BullMQ queue adapter for dispatching conversion jobs. |
| [`@node-media-library/pdf`](packages/pdf/README.md) | `pdftoppm`-backed `ImageGenerator` for rasterizing PDF originals. |
| [`@node-media-library/video`](packages/video/README.md) | `ffmpeg`-backed `ImageGenerator` for extracting video frame thumbnails. |
| [`@node-media-library/optimizers`](packages/optimizers/README.md) | `jpegoptim`/`pngquant`-backed `ImageOptimizer`s for shrinking conversion/responsive output. |

## Quickstart

Start with [`packages/core/README.md`](packages/core/README.md) — it covers installation, configuring storage disks and models, uploading files, defining conversions, and using the CLI. Add `@node-media-library/prisma` for a database-backed repository and `@node-media-library/pdf` / `@node-media-library/video` if you need to rasterize non-image originals.

## System binaries

`@node-media-library/pdf` shells out to `pdftoppm` (poppler-utils) and `@node-media-library/video` shells out to `ffmpeg`. Both packages skip their binary-gated tests when the binary isn't on `PATH`; install the binaries to exercise those suites and to use the generators at runtime. CI (see `.github/workflows/ci.yml`) installs both via `apt-get` so those suites — plus the BullMQ Redis-backed suite — run for real there, even though they're skipped in most local/dev environments.

## Roadmap / known limitations

v1 now includes everything from the original design spec (`docs/superpowers/specs/2026-07-26-node-media-library-design.md`)
plus Spatie-parity extras shipped afterward: `copyMedia`/`moveMedia`, atomic custom-property updates, an image
optimizer seam, and a GCS storage driver. What's left is architectural, not scheduled work: `@node-media-library/video`
buffers the whole source video in memory and spawns one `ffmpeg` process per frame extraction; the Prisma
adapter's JSON-column merges aren't lock-safe against concurrent merges on the same record under Postgres/MySQL's
read-committed isolation (SQLite is fine — single-writer). See
[`packages/core/README.md`](packages/core/README.md#roadmap) for details.

## Development

```bash
pnpm install      # install workspace dependencies
pnpm -r test       # run every package's test suite (binary/Redis-gated suites skip without the prerequisite)
pnpm -r typecheck  # typecheck every package
pnpm build         # build dist/ for every package (tsc -p tsconfig.build.json)
```

Publishing must go through `pnpm publish` (or `pnpm pack`) — each package's `prepack` script
(`scripts/ensure-pnpm-pack.mjs`) fails fast under bare `npm publish`/`npm pack`, since npm ignores
`publishConfig.exports` and would ship a tarball pointing at unbuilt `src/`.

## License

MIT — see [LICENSE](LICENSE).
