---
title: Install & requirements
description: What to install, what each package needs, and which optional system binaries unlock PDF, video, and image optimization.
---

## Requirements

- **Node 22 or newer.** The library targets Node ≥ 22. (This documentation site needs Node ≥ 22.12
  because Astro does, which is why it isn't part of the pnpm workspace.)
- **A repository backend.** `InMemoryMediaRepository` ships with core and is enough for tests and for
  the [five-minute guide](/start/first-upload/). For anything real, use the Prisma adapter or
  implement `MediaRepository` yourself.
- **Somewhere to put files.** A local directory works out of the box; S3 and GCS are configuration.

## Install

```bash
pnpm add @node-media-library/core
```

Add the adapters you actually need — nothing is pulled in for you:

```bash
pnpm add @node-media-library/prisma      # database-backed repository
pnpm add @node-media-library/bullmq      # queued conversions via Redis
pnpm add @node-media-library/rabbitmq    # queued conversions via RabbitMQ
pnpm add @node-media-library/pdf         # PDF page thumbnails
pnpm add @node-media-library/video       # video frame thumbnails
pnpm add @node-media-library/optimizers  # jpegoptim / pngquant
```

:::caution[Not on npm yet]
These commands are what installation will look like. Until the first release, install from a git
checkout of the [repository](https://github.com/mujtabarumi/node-media-library). Use pnpm rather than
npm — each package's `prepack` script deliberately fails under bare `npm publish`/`npm pack`, because
npm ignores `publishConfig.exports` and would produce a tarball whose entry points reference unbuilt
TypeScript source.
:::

## Optional system binaries

Three packages shell out to binaries that are **not bundled**. Each degrades quietly when its binary
is missing rather than crashing: the optimizers become no-ops, and the PDF and video generators
simply don't claim support for their MIME types — so those uploads still succeed, they just get no
thumbnail.

| Package      | Binary                  | macOS                             | Debian/Ubuntu                    |
| ------------ | ----------------------- | --------------------------------- | -------------------------------- |
| `pdf`        | `pdftoppm` (poppler)    | `brew install poppler`            | `apt install poppler-utils`      |
| `video`      | `ffmpeg`                | `brew install ffmpeg`             | `apt install ffmpeg`             |
| `optimizers` | `jpegoptim`, `pngquant` | `brew install jpegoptim pngquant` | `apt install jpegoptim pngquant` |

## Peer dependencies

| Package    | Peer                    | Required?                                       |
| ---------- | ----------------------- | ----------------------------------------------- |
| `core`     | `@google-cloud/storage` | Optional — only for the `gcs` storage driver.   |
| `prisma`   | `@prisma/client`        | Optional — bring your own version (`>=6.2 <8`). |
| `bullmq`   | `bullmq`                | Required (`^5 \|\| ^6`).                        |
| `rabbitmq` | `amqplib`               | Required (`^0.10`).                             |

## Nothing auto-registers

Worth internalising before you go further, because it explains most "why isn't this working"
questions: installing a package enables nothing. `@node-media-library/pdf` does not start rendering
PDFs until you add `pdfImageGenerator()` to the `imageGenerators` array, and the optimizers do
nothing until they're listed in `optimizers`. The upside is that a config file tells you exactly what
will happen to an upload, with no hidden discovery step.

Next: [store your first file →](/start/first-upload/)
