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

## Quickstart

Start with [`packages/core/README.md`](packages/core/README.md) — it covers installation, configuring storage disks and models, uploading files, defining conversions, and using the CLI. Add `@node-media-library/prisma` for a database-backed repository and `@node-media-library/pdf` / `@node-media-library/video` if you need to rasterize non-image originals.

## System binaries

`@node-media-library/pdf` shells out to `pdftoppm` (poppler-utils) and `@node-media-library/video` shells out to `ffmpeg`. Both packages skip their binary-gated tests when the binary isn't on `PATH`; install the binaries to exercise those suites and to use the generators at runtime. CI (see `.github/workflows/ci.yml`) installs both via `apt-get` so those suites — plus the BullMQ Redis-backed suite — run for real there, even though they're skipped in most local/dev environments.

## Roadmap / not yet implemented

The original design spec (`docs/superpowers/specs/2026-07-26-node-media-library-design.md`) included a few
items that didn't make it into v1: media-level `move()`, `copy()`, and `setCustomProperty()`, and a GCS storage
driver (only `fs` and `s3` are wired up today). See [`packages/core/README.md`](packages/core/README.md#roadmap)
for details and workarounds.

## Development

```bash
pnpm install      # install workspace dependencies
pnpm -r test       # run every package's test suite (binary/Redis-gated suites skip without the prerequisite)
pnpm -r typecheck  # typecheck every package
pnpm build         # build dist/ for every package (tsc -p tsconfig.build.json)
```

## License

MIT — see [LICENSE](LICENSE).
