# @node-media-library/pdf

## 1.0.0

> **First published release.** The entries below record development that predates this package
> reaching npm, so the breaking-change and migration notes describe commits rather than a shipped
> release. Nothing here requires action from a new installation.

### Minor Changes

- 6698e20: Raise the supported Node floor from `>=20` to `>=22`.

  `file-type@22`, a runtime dependency of core, declares `node: >=22`. Core previously declared
  `>=20`, so installing on Node 20 produced an `EBADENGINE` warning (and a hard failure under
  `engine-strict`) while the package claimed to support it. Every package's `engines` field now says
  `>=22`, matching what the dependency tree actually requires.

  **Node 20 is no longer supported.** Consumers on Node 20 should stay on the previous release or
  upgrade to Node 22. `@types/node` moves to `^22` to keep types tracking the minimum supported
  runtime, and CI now tests Node 22 only.

### Patch Changes

- 8f9bf4d: Fix README examples that don't match shipped behavior. The core Quick Start omitted `baseUrl` from its
  `fs` disk config, so its own `firstUrl()` calls threw `StorageError`; the PDF and video packages showed
  `conversion().…toDefinition()` as the usage form, but `conversions()` takes builders and calls
  `toDefinition()` itself. Core also gains a "URL building per driver" section documenting that
  `signedUrl()` does not sign on the `fs` driver and that `baseUrl` is unconsumed by `s3`/`gcs`.
- Updated dependencies [e8b7700]
- Updated dependencies [ea06f00]
- Updated dependencies [6698e20]
- Updated dependencies [d092bf5]
- Updated dependencies [8f9bf4d]
- Updated dependencies [6be9a32]
  - @node-media-library/core@1.0.0
