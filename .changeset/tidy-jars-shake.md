---
'@node-media-library/core': patch
'@node-media-library/video': patch
'@node-media-library/pdf': patch
---

Fix README examples that don't match shipped behavior. The core Quick Start omitted `baseUrl` from its
`fs` disk config, so its own `firstUrl()` calls threw `StorageError`; the PDF and video packages showed
`conversion().…toDefinition()` as the usage form, but `conversions()` takes builders and calls
`toDefinition()` itself. Core also gains a "URL building per driver" section documenting that
`signedUrl()` does not sign on the `fs` driver and that `baseUrl` is unconsumed by `s3`/`gcs`.
