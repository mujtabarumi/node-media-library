---
'@node-media-library/core': patch
---

Document configuration as a first-class topic rather than something readers assemble from examples.
The package README gains a "Configuration reference" table covering all sixteen `MediaLibraryConfig`
keys with their defaults — `versionUrls`, `signedUrlExpiresIn`, `allowedExtensions`,
`responsiveWidthCalculator`, and `responsivePlaceholders` had no prose documentation anywhere — and
the Quick Start's queue comment now names `deferDriver()` and `rabbitmqDriver()` alongside
`bullmqDriver()`, which it had omitted since the driver split.

No behavior change.
