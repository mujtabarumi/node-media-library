---
'@node-media-library/optimizers': minor
'@node-media-library/core': minor
'@node-media-library/prisma': minor
'@node-media-library/bullmq': minor
'@node-media-library/video': minor
'@node-media-library/pdf': minor
---

Raise the supported Node floor from `>=20` to `>=22`.

`file-type@22`, a runtime dependency of core, declares `node: >=22`. Core previously declared
`>=20`, so installing on Node 20 produced an `EBADENGINE` warning (and a hard failure under
`engine-strict`) while the package claimed to support it. Every package's `engines` field now says
`>=22`, matching what the dependency tree actually requires.

**Node 20 is no longer supported.** Consumers on Node 20 should stay on the previous release or
upgrade to Node 22. `@types/node` moves to `^22` to keep types tracking the minimum supported
runtime, and CI now tests Node 22 only.
