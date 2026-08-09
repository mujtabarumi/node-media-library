---
title: Coming from Laravel MediaLibrary
description: How the concepts translate from spatie/laravel-medialibrary, and where this port deliberately diverges.
---

If you've used `spatie/laravel-medialibrary`, you already know the model: attach files to records, group
them into collections, declare conversions, get URLs back. That transfers directly. The API is
Node-idiomatic rather than a transliteration, so the shapes differ.

:::caution[This is not a migration tool]
There is no importer for an existing Laravel `media` table, and the schema is not identical. This page
maps concepts, not data. Moving a live library across would mean writing a script that re-adds each file
through `add()` so conversions regenerate under the new config.
:::

## The translation

| Laravel MediaLibrary                        | Here                                                            |
| ------------------------------------------- | --------------------------------------------------------------- |
| `InteractsWithMedia` trait on a model       | Register the model type by name in `models: { User: { … } }`    |
| `$user->addMedia($f)->toMediaCollection()`  | `library.for('User', id).add(f).toCollection()`                 |
| `registerMediaCollections()`                | `collection()` builders in config                               |
| `registerMediaConversions()`                | `conversion()` builders, per collection                         |
| `$user->getMedia('gallery')`                | `await library.for('User', id).getAll('gallery')`               |
| `$user->getFirstMediaUrl('avatar','thumb')` | `await library.for('User', id).firstUrl('avatar', 'thumb')`     |
| `$media->getSrcset()`                       | `await library.srcset(media.id)`                                |
| `$user->clearMediaCollection('gallery')`    | `await library.for('User', id).clear('gallery')`                |
| `addMediaFromUrl($url)`                     | `add({ url, allowedHosts })`                                    |
| `->preservingOriginal()`                    | `.preservingOriginal()`                                         |
| `->withCustomProperties([...])`             | `.withCustomProperties({ … })`                                  |
| `media:regenerate` / `media:clean`          | `node-media-library regenerate` / `clean`                       |
| `php artisan queue:work`                    | `node-media-library worker` / `MediaLibrary.startWorker()`      |
| Laravel filesystem disks                    | flydrive disks (`fs` / `s3` / `gcs`)                            |
| Laravel queues                              | `QueueDriver` — `syncDriver()` by default, or BullMQ/RabbitMQ   |
| Eloquent `Media` model                      | `MediaRepository` interface — Prisma adapter, or bring your own |

Collection and conversion builders carry over almost verbatim: `singleFile()`, `onlyKeepLatest(n)`,
`acceptsMimeTypes([...])`, `withResponsiveImages()`, `nonQueued()`, `width()`, `height()`, `format()`,
`quality()`, `sharpen()`, `blur()`, `greyscale()`.

## Where it diverges, and why

### No ORM coupling

The biggest structural difference. There is no trait to add to a model, because there is nothing to add
it to — the library never sees your models. You name a `modelType` string and the repository stores it
alongside a `modelId`.

That's what lets one media table serve a Prisma model, a Drizzle model, and a row you fetched with raw
SQL. The cost is that your database won't cascade deletes for you; see
[persistence with Prisma](/production/prisma/) for the two mechanisms that cover it.

### Configuration lives in one place, not on the model

Laravel puts `registerMediaCollections()` and `registerMediaConversions()` on the model class. Here
everything is declared in the config object passed to `createMediaLibrary()`.

The practical consequence is that a **worker process must be built from the same config** as the web
process, since that's where conversion definitions live. See
[background conversions](/guides/background-conversions/).

### Everything that touches storage is async

`firstUrl()`, `srcset()`, `signedUrl()`, and `getAll()` all return promises. Building a URL can mean
asking a driver to sign one, so there's no synchronous accessor to reach for.

### sharp, not Glide

Conversions expose sharp's vocabulary. `fit` takes `'cover' | 'contain' | 'fill' | 'inside' | 'outside'`
rather than Glide's fit names, and `autoOrient` is on by default.

### Downloads are web-standard `Response` objects

`download()`, `inline()`, and `zip()` return a `Response`, not a framework response. That works directly
in Hono, Next.js route handlers, Bun, and Deno; for Express, `toNodeStream()` bridges it. See
[handling uploads](/guides/uploads/).

### Nothing auto-registers

Laravel's package discovery wires things up on install. Here, PDF and video support is an explicit
`imageGenerators` entry and optimizers are an explicit `optimizers` entry. Installing a package changes
nothing until you wire it in — see [packages](/reference/packages/).

### Conversions are per collection

A conversion is declared inside the collection it belongs to, rather than on the model with
`performOnCollections()` narrowing it afterwards. That escape hatch exists, but the default shape is
collection-scoped.

## Things Laravel has that this doesn't

Worth knowing before you plan around them:

- **No Blade/template integration.** You call the API and render the result yourself.
- **No conversion registration on the fly** — definitions are resolved once, at construction.
- **No Nova or Filament integrations.**
- **No `addMediaFromRequest()`** — pass the `File` from `formData()`, or multer's path, straight to
  `add()`. That's the equivalent, and it works the same way for every framework.

## Things this has that Laravel doesn't

- **A repository contract suite** you can run against your own backend, exported from
  `@node-media-library/core/testing`.
- **Documented sharp edges.** [Known limitations](/production/limitations/) states where the guarantees
  stop, with anchors linked from the pages where each one bites.
- **Executable documentation.** The code on most guide pages is imported from files that run in CI, so a
  sample that stops working fails the build.

## Where to start

Don't read this site front to back. [Your first upload](/start/first-upload/) will feel familiar within a
minute, and [core concepts](/start/concepts/) names the three nouns precisely. After that, the guide
matching whatever you were doing in Laravel will be the fastest route.
