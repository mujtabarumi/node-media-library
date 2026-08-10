---
'@node-media-library/core': patch
---

Narrow the barrel's storage exports to `DiskConfig`, `StorageConfig`, `S3Credentials`, and
`ResolvedStorage`.

`resolveStorage`, `normalizeR2`, and `writeOptionsFor` are no longer reachable from the package root.
They were only ever exported by an `export *`, and their `@internal` tags stripped nothing, since no
tsconfig sets `stripInternal`.

`ResolvedStorage` loses its `@internal` tag. `MediaLibrary.storage` is a public getter returning it,
so the type was already part of the contract and the tag was simply wrong.
