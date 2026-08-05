---
title: Errors
description: Every error class the library throws, its stable code, what triggers it, and the HTTP status that usually fits.
---

Every failure is a typed error extending `MediaLibraryError`, each carrying a stable `code` string.
Match on the class in TypeScript, or on `code` across a process boundary — both are part of the
public API and won't change without a major version.

## The table

| Class                      | `code`                 | Thrown when                                                                                   | Usual status |
| -------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- | ------------ |
| `FileTooLargeError`        | `FILE_TOO_LARGE`       | The file exceeds `maxFileSize` (default 10 MiB). For streams and URLs, thrown mid-transfer.   | `413`        |
| `UnacceptableFileError`    | `UNACCEPTABLE_FILE`    | The collection's `acceptsMimeTypes` or `acceptsFile` predicate rejected it.                   | `415`        |
| `DisallowedExtensionError` | `DISALLOWED_EXTENSION` | A blocklisted extension in any dot-segment, or a final extension outside `allowedExtensions`. | `422`        |
| `UnknownModelError`        | `UNKNOWN_MODEL`        | `for()` was called with a model type that isn't registered in `models`.                       | `500`        |
| `DownloadFailedError`      | `DOWNLOAD_FAILED`      | A URL source failed: bad status, non-allowlisted host, a redirect, or unsupported protocol.   | `400`        |
| `ConversionFailedError`    | `CONVERSION_FAILED`    | An image generator failed while producing a derived file.                                     | `500`        |
| `StorageError`             | `STORAGE_ERROR`        | An unknown disk name, or a driver that cannot build the requested URL.                        | `500`        |
| `MediaLibraryError`        | `MEDIA_LIBRARY_ERROR`  | The base class. Also thrown directly for "media not found" and unsupported sources.           | —            |

The status column is a suggestion, not something the library enforces — it returns no HTTP responses
of its own except from `download()`, `inline()`, and `zip()`.

## Which are the user's fault

A useful split when deciding what to surface:

**Caused by the uploaded file** — safe to report back, and worth reporting specifically, because the
message names the actual problem:

- `FileTooLargeError`
- `UnacceptableFileError`
- `DisallowedExtensionError`
- `DownloadFailedError`

**Caused by configuration or infrastructure** — log these, show the user something generic:

- `UnknownModelError` — a model type is missing from `models`, i.e. a bug in your config.
- `StorageError` — most often an `fs` disk with no `baseUrl`, or a disk name that doesn't exist.
- `ConversionFailedError` — a generator failed; check that the binary a PDF/video conversion needs is
  installed.

## Handling them

```ts
import {
  MediaLibraryError,
  FileTooLargeError,
  UnacceptableFileError,
  DisallowedExtensionError,
  DownloadFailedError,
} from '@node-media-library/core'

const STATUS = new Map<string, number>([
  ['FILE_TOO_LARGE', 413],
  ['UNACCEPTABLE_FILE', 415],
  ['DISALLOWED_EXTENSION', 422],
  ['DOWNLOAD_FAILED', 400],
])

try {
  await library.for('User', id).add(file).toCollection('avatar')
} catch (err) {
  if (err instanceof MediaLibraryError) {
    const status = STATUS.get(err.code)
    if (status) return res.status(status).json({ error: err.message, code: err.code })
    logger.error({ err }, 'media library failure')
    return res.status(500).json({ error: 'Upload failed' })
  }
  throw err
}
```

Matching on `code` rather than the class keeps this working across a queue or RPC boundary, where the
prototype chain is lost.

## What does not throw

Some things fail quietly by design, so don't write handlers expecting an exception:

- **An unsupported MIME type gets no conversions.** If no configured `ImageGenerator` claims a file's
  type, conversions and responsive images are skipped and the upload still succeeds. A `.zip` in an
  attachments collection is stored and downloadable — it just has no thumbnail.
- **A failing optimizer is skipped.** It's logged with `console.warn` and the unoptimized bytes are
  kept. Optimization is best-effort, never a correctness requirement.
- **Queued conversion failures don't reach `add()`.** They surface as the `conversion:failed` event
  and through your queue's own failure handling. Only `.nonQueued()` conversions can reject the
  `toCollection()` call — and even then the media record is already persisted.

That last point is deliberate: an upload that stored the file but failed to make a thumbnail is a
recoverable state, and `regenerate({ onlyMissing: true })` is how you recover it.
