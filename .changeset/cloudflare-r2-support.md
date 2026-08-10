---
'@node-media-library/core': minor
---

Add first-class Cloudflare R2 support via a new `driver: 'r2'` disk config, which derives the S3 API endpoint from your account ID, disables the ACL headers R2 rejects, and builds public URLs from `baseUrl`.

The `s3` driver gains `credentials`, `supportsACL`, `forcePathStyle`, and `requestChecksumCalculation`, making MinIO, Backblaze B2, and DigitalOcean Spaces configurable too. `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are now declared as optional peer dependencies — install them to use `s3` or `r2`.

`baseUrl` is now honored on every driver, not just `fs`. **If you already set `baseUrl` on an `s3` or `gcs` disk it was silently ignored, and public URLs will now be built from it.** That was the documented behavior it replaces, but it does change the URLs those disks emit.

Public collections on an R2 disk with no `baseUrl` now throw when the `MediaLibrary` is constructed, because R2 has no object ACLs and such a URL could never resolve. Supplying your own `urlGenerator` downgrades that to a `console.warn` — a custom generator may build public URLs from CDN logic core cannot see, so core must not declare the configuration broken.

`url()` (and `firstUrl()`, `availableUrl()`, `responsiveUrl()`, `responsiveUrls()`, `srcset()`) now throw `StorageError` for **any** collection on an `r2` disk with no `baseUrl`, not just `.public()` ones. They previously returned `https://{accountId}.r2.cloudflarestorage.com/{bucket}/{key}` — the authenticated S3 API host, which rejects anonymous reads — so the change is from a silently dead link to a loud error. Set `baseUrl`, or use `signedUrl()`, which is unaffected.
