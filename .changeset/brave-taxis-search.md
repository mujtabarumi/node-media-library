---
'@node-media-library/core': patch
---

Update `archiver` to 8.x. Version 8 is ESM-only and replaced the callable `archiver('zip')` factory
with named class exports, so `zip()` now constructs `new ZipArchive()`. No change to `zip()`'s
signature, return type, or lazy-streaming behavior. `archiver` 8 requires Node >=18, which is below
this project's >=20 floor, so the supported runtime range is unchanged.
