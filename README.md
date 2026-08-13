# node-media-library

[![CI](https://github.com/mujtabarumi/node-media-library/actions/workflows/ci.yml/badge.svg)](https://github.com/mujtabarumi/node-media-library/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json)

**Attach files to anything in your app — then stop thinking about them.**

You register a model type (`User`, `Post`, `Invoice`) and the collections that hang off it (`avatar`,
`gallery`, `attachments`). From then on, one call stores the file, validates it, derives the thumbnails
and responsive variants you declared, and gives you back a URL. Deleting the record deletes every
derived file with it.

```ts
const media = await library.for('User', user.id).add(uploadedFile).toCollection('avatar')

await library.for('User', user.id).firstUrl('avatar', 'thumb')
// → 'https://cdn.example.com/9f3.../conversions/photo-thumb.jpg'
```

A Node port of [spatie/laravel-medialibrary](https://github.com/spatie/laravel-medialibrary) — the same
mental model (models → collections → conversions), rebuilt on Node primitives: pluggable storage via
[flydrive](https://flydrive.dev) (fs/S3/R2/GCS), a pluggable repository (Prisma adapter included), a
pluggable queue (BullMQ and RabbitMQ adapters included), and
[sharp](https://sharp.pixelplumbing.com) for image work — an optional peer dependency you install
yourself.

---

## Requirements

- **Node 22 or newer**
- **A place to store media rows** — the bundled `InMemoryMediaRepository` for tests,
  [`@node-media-library/prisma`](packages/prisma/README.md) for real use, or your own `MediaRepository`
- **Optional system binaries**, only for the packages that use them: `pdftoppm` (PDF), `ffmpeg`
  (video), `jpegoptim`/`pngquant` (optimizers). Each package no-ops when its binary is absent.
- **`sharp`, an optional peer dependency of `@node-media-library/core`** — needed for image
  conversions, responsive images, and placeholders (Step 5 below uses it). Install it alongside core
  (`pnpm add @node-media-library/core sharp`); omit it only if you never convert images, or you supply
  your own `config.imageGenerators`. Nothing auto-installs it: npm and pnpm both skip peers marked
  optional, and Yarn never auto-installs peers at all.

---

# Getting started

Five steps, about ten minutes. No database and no cloud account — you'll use an in-memory repository
and a local folder, then swap both out at the end.

## Step 1 — Install the core package

```bash
pnpm add @node-media-library/core sharp
```

> **sharp is an optional peer dependency.** It is required for image conversions, responsive images,
> and placeholders — which Step 5 below uses. Omit it only if you store files without ever converting
> them, or if you supply your own `config.imageGenerators`. Nothing auto-installs it: npm and pnpm
> both skip peers marked optional, and Yarn never auto-installs peers at all.

Adapters are separate packages and nothing is pulled in for you — you'll add one in
[Next steps](#next-steps).

Working from a checkout of this repo instead? See
[CONTRIBUTING.md](CONTRIBUTING.md) — a package's `exports` points at `src/*.ts` so the workspace runs
from source, and only `pnpm pack` applies the `publishConfig.exports` override that repoints entry
points at built `dist/`, so a `file:` dependency hands your app raw TypeScript that Node cannot load.

## Step 2 — Create your config

This is the one file that describes your media setup. Everything else reads from it.

```ts
// media.ts
import { createMediaLibrary, InMemoryMediaRepository, collection } from '@node-media-library/core'

export const library = createMediaLibrary({
  // Where media rows live. In-memory for now — swapped for a database later.
  repository: new InMemoryMediaRepository(),

  // Where the files themselves land.
  storage: {
    disks: {
      default: { driver: 'fs', root: './storage/media' },
    },
  },

  // Which model types can own media, and what collections they have.
  models: {
    User: {
      collections: {
        avatar: collection().singleFile().acceptsMimeTypes(['image/*']),
      },
    },
  },
})
```

Only `repository` and `models` are required — every other key has a working default.

**No environment variables yet.** An in-memory repository and a local folder need no credentials, so
there is nothing to put in a `.env` until you swap one of them out. See
[Environment variables](#environment-variables) for what each swap needs.

✅ **You should now be able to import `library` without an error.** Nothing has touched the disk yet.

## Step 3 — Store a file

```ts
import { library } from './media.js'

const media = await library.for('User', 'user-1').add('/tmp/photo.png').toCollection('avatar')

console.log(media.id) //  '0e5f…'     — the media record id
console.log(media.mimeType) //  'image/png'  — sniffed from the bytes, not the filename
```

✅ **You should now see a new directory under `./storage/media/`**, named after the media id, with your
file inside it.

Two things happened that you didn't ask for, and both are the point of the library:

- The file was **validated against the collection** (`image/*`), not against ad-hoc checks at the call
  site. A `.png` that is actually a PHP script is rejected here — the MIME type comes from the bytes.
- Because `avatar` is `singleFile()`, any previous avatar for `user-1` was **deleted**, files included.
  You never write cleanup code.

> A filesystem-path source is **moved**, not copied — `/tmp/photo.png` is consumed. Call
> `.preservingOriginal()` if you need it to survive.

## Step 4 — Get a URL back

```ts
await library.for('User', 'user-1').firstUrl('avatar')
```

Right now this throws `StorageError`. That's expected: the `fs` driver has no way to guess how your
files are served, so you have to tell it. Add `baseUrl` to the disk:

```ts
// media.ts
default: {
  driver: 'fs',
  root: './storage/media',
  baseUrl: 'http://localhost:3000/media',   // ← add this
},
```

Point it at whatever path your server serves `./storage/media` from:

```ts
app.use('/media', express.static('./storage/media'))
```

✅ **`firstUrl('avatar')` now returns a URL** you can open in a browser.

Every driver honors `baseUrl`, so this is also how you put a CDN hostname in front of an S3 or R2
bucket later.

## Step 5 — Add a thumbnail

Declare the conversion on the collection, and it is derived on every upload from then on:

```ts
import { collection, conversion } from '@node-media-library/core'

avatar: collection()
  .singleFile()
  .acceptsMimeTypes(['image/*'])
  .conversions({
    // .nonQueued() runs it inline, so the URL is valid the moment add() resolves
    thumb: conversion().width(96).height(96).fit('cover').format('webp').nonQueued(),
  })
```

```ts
await library.for('User', 'user-1').firstUrl('avatar', 'thumb') //  96×96 webp
```

✅ **You should now see a `conversions/` folder** beside the original, containing the webp thumbnail.
Delete the media and both go with it.

**That's the whole model.** Files belong to a collection, the collection declares its rules and its
derived variants, and the library keeps the two in sync.

---

## Next steps

The quickstart runs on two defaults that exist so you can try the library without provisioning
anything. Those are the two you replace first.

| You want to…                                | Do this                                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep media across restarts**              | `InMemoryMediaRepository` is for tests. Install [`@node-media-library/prisma`](packages/prisma/README.md), add the `Media` model, and migrate. |
| **Stop conversions blocking your requests** | Conversions run inline by default. Add [`bullmq`](packages/bullmq/README.md) or [`rabbitmq`](packages/rabbitmq/README.md) and run a worker.    |
| **Store on S3, R2, or GCS**                 | Change the disk's `driver` and install the peer SDK — see [Storage disks](packages/core/README.md#storage-disks).                              |
| **Wire it into Express / Hono / Next.js**   | `add()` takes whatever your framework hands you — see [Handling uploads](website/src/content/docs/guides/uploads.mdx).                         |
| **Thumbnail PDFs and videos**               | Append [`pdf`](packages/pdf/README.md) / [`video`](packages/video/README.md) generators — nothing auto-registers.                              |
| **Serve private files**                     | Storage is private by default; use `signedUrl()`, or stream the bytes yourself with `download()`.                                              |

## Environment variables

Copy [`.env.example`](.env.example) and fill in what you need. Nothing is required for the quickstart.

**Only `MEDIA_*` variables are read by this library**, and only when you omit `storage` from
`createMediaLibrary()` entirely. The moment you pass `storage.disks`, they're ignored — configure the
disk in code instead. (`MEDIA_PREFIX` is the exception: it backs `storage.prefix` either way.)

| Variable                                                  | When it applies           | Notes                                                                         |
| --------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `MEDIA_R2_ACCOUNT_ID`, `MEDIA_R2_BUCKET`                  | 1st — wins over S3/GCS/fs | Setting the account id without the bucket **throws** rather than fall through |
| `MEDIA_R2_ACCESS_KEY_ID`, `MEDIA_R2_SECRET_ACCESS_KEY`    | with R2                   | Both required, or neither is applied                                          |
| `MEDIA_R2_BASE_URL`                                       | with R2                   | Required for public reads — R2 has no object ACLs                             |
| `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`, `MEDIA_S3_ENDPOINT` | 2nd                       | `ENDPOINT` covers MinIO, Backblaze, Spaces                                    |
| `MEDIA_GCS_BUCKET`                                        | 3rd                       | Credentials via `GOOGLE_APPLICATION_CREDENTIALS`                              |
| `MEDIA_FS_ROOT`                                           | 4th — the fallback        | Defaults to `./storage/media`. `baseUrl` has no env var; set it in config     |
| `MEDIA_PREFIX`                                            | always                    | Prefixes every stored path on any driver                                      |
| `NODE_ENV`                                                | always                    | `production` + a local fs disk logs a durability warning at startup           |

**Everything else is read by somebody other than this library.** You read it and pass the result in:

| Variable                                     | Read by             | You use it for                                                 |
| -------------------------------------------- | ------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`                               | Prisma              | `prismaAdapter(new PrismaClient())`                            |
| `REDIS_URL`                                  | your code → BullMQ  | `bullmqDriver({ connection: { url: process.env.REDIS_URL } })` |
| `AMQP_URL`                                   | your code → amqplib | `rabbitmqDriver({ url: process.env.AMQP_URL })`                |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | AWS SDK             | S3/R2 auth when you don't pass `credentials` on the disk       |
| `GOOGLE_APPLICATION_CREDENTIALS`             | Google Cloud SDK    | GCS auth                                                       |

> **Don't confuse these with the repo's own test gates.** Unprefixed `R2_ACCOUNT_ID`, `R2_BUCKET`,
> `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BASE_URL` — plus `REDIS_URL` and `AMQP_URL` —
> gate this repository's integration suites in CI. They are contributor secrets, not application
> config. An app configures storage with `MEDIA_R2_*`. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

Full guides, the configuration reference, and the generated API docs live in
[`website/`](website/README.md). The site isn't deployed yet — run it locally:

```bash
cd website && pnpm install && pnpm dev
```

**Every code sample in these guides is executed in CI.** They aren't written inline — they're
imported from [`examples/`](examples/README.md), a workspace member with its own vitest suite, so
`pnpm -r test` runs them and the docs build fails if a referenced snippet disappears. A sample that
drifts from the shipped API breaks the build rather than misleading you.

You can read the pages on GitHub, with one caveat: because those samples are injected at build
time, GitHub renders the prose and **silently drops the code blocks** on the pages marked † below.
For those, run the site locally or read the sources under [`examples/src/`](examples/src/).

| Topic                                                                                | Covers                                                      |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| [Configuration reference](website/src/content/docs/reference/configuration.mdx)      | Every `createMediaLibrary()` option and its default         |
| [Handling uploads](website/src/content/docs/guides/uploads.mdx)                      | Express, Hono, Next.js, and mapping errors to HTTP statuses |
| [Avatars](website/src/content/docs/guides/avatars.mdx) †                             | Single-file collections and fallback images                 |
| [Galleries & responsive images](website/src/content/docs/guides/galleries.mdx) †     | Ordering, `srcset`, LQIP placeholders, keep-latest          |
| [Private files & downloads](website/src/content/docs/guides/private-files.mdx) †     | Signed URLs, streamed responses, bulk ZIP                   |
| [Background conversions](website/src/content/docs/guides/background-conversions.mdx) | Queue drivers, workers, shutdown semantics                  |
| [PDF & video thumbnails](website/src/content/docs/guides/pdf-video.mdx)              | Registering extra image generators                          |
| [Importing from a URL](website/src/content/docs/guides/url-import.mdx) †             | Host allowlists, and what they don't protect against        |
| [Metadata, copy & move](website/src/content/docs/guides/metadata.mdx) †              | Custom properties, filtering, reassigning owners            |
| [Persistence with Prisma](website/src/content/docs/production/prisma.mdx)            | Schema, migrations, cascading deletes                       |
| [Security model](website/src/content/docs/production/security.md)                    | MIME sniffing, sanitization, size caps, visibility          |
| [CLI](website/src/content/docs/reference/cli.md)                                     | `regenerate` and `clean`                                    |
| [Coming from Laravel MediaLibrary](website/src/content/docs/coming-from-laravel.md)  | API mapping and deliberate differences                      |

[`packages/core/README.md`](packages/core/README.md) is the deepest single document — driver contracts,
URL building per driver, and the full security rationale.

## Packages

Every package is independently publishable and depends only on `@node-media-library/core` — never on a
sibling adapter.

| Package                                                           | What it's for                                                                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`@node-media-library/core`](packages/core/README.md)             | The engine — storage, collections, conversions, responsive images, downloads, CLI. |
| [`@node-media-library/prisma`](packages/prisma/README.md)         | `MediaRepository` backed by Prisma, plus an opt-in cascading-delete extension.     |
| [`@node-media-library/bullmq`](packages/bullmq/README.md)         | `QueueDriver` that dispatches conversions to BullMQ workers.                       |
| [`@node-media-library/rabbitmq`](packages/rabbitmq/README.md)     | `QueueDriver` that dispatches conversions to RabbitMQ workers.                     |
| [`@node-media-library/pdf`](packages/pdf/README.md)               | `ImageGenerator` rasterizing PDF pages via `pdftoppm`.                             |
| [`@node-media-library/video`](packages/video/README.md)           | `ImageGenerator` extracting video frames via `ffmpeg`.                             |
| [`@node-media-library/optimizers`](packages/optimizers/README.md) | `jpegoptim`/`pngquant` optimizers that shrink conversion and responsive output.    |

## Known limitations

Stated up front, because finding these out in production is worse:

- **Concurrent `add()` calls to the same collection race.** Sibling lists are read without locking, so
  two simultaneous uploads to a `singleFile()` collection can briefly both persist. Serialize per
  (model, collection) if you need a hard guarantee.
- **Prisma JSON-column merges aren't lock-safe** under Postgres/MySQL read-committed isolation — two
  concurrent merges on the _same_ record can lose a write. SQLite is unaffected (single writer).
- **`signedUrl()` doesn't sign on the `fs` driver.** It falls back to the plain public URL and ignores
  `expiresIn`. Don't ship private media on an `fs` disk assuming the URL expires.
- **`@node-media-library/video` buffers the whole source video in memory** and spawns one `ffmpeg`
  process per frame extraction. Fine for typical clips; not tuned for large files.
- **R2-specific behavior is only verified when `R2_*` repository secrets are configured.** CI runs the
  shared storage contract against MinIO for the `s3` path, but MinIO accepts ACLs, so it can't prove
  R2's `supportsACL: false` suppression or its checksum handling.
- **`clean()` is not concurrency-safe** with running workers — it diffs on-disk files against config,
  and a worker writing one mid-diff can cause a spurious or missed delete. Run it offline.

Full detail: [Known limitations](website/src/content/docs/production/limitations.mdx).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers prerequisites, the optional binaries the gated suites need,
scoping tests to one package, and the conventions enforced in review — including that docs must match
shipped behavior, and that repository changes go through the shared contract suite.

```bash
pnpm install       # pnpm only — npm ignores publishConfig.exports and would ship a broken tarball
pnpm -r test       # every package (binary/Redis-gated suites skip without their prerequisite)
pnpm -r typecheck
pnpm build
```

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). Found a vulnerability? Report
it privately per [SECURITY.md](SECURITY.md). The original design spec lives at
[`docs/superpowers/specs/`](docs/superpowers/specs/).

## License

MIT — see [LICENSE](LICENSE).
