# Cloudflare R2 support — Design Spec

**Date:** 2026-08-10
**Status:** Approved design, pre-implementation
**Goal:** Make Cloudflare R2 a first-class storage target that a user adopts by changing configuration only — no custom `UrlGenerator`, no env-var-only escape hatches, no undocumented flags to discover. Along the way, close the adjacent gaps that make the existing `s3` driver nominally-supported-but-unproven.

## 1. Motivation

The 2026-07-26 design spec already lists R2 among the supported storage backends (§2, "FlyDrive (fs, S3, R2, GCS)"). The code never shipped it. An audit on 2026-08-10 found that R2 is not merely undocumented but **unusable**, and that the generic `s3` path it would build on has never executed in any test.

Two defects make R2 fail today:

1. **Every write sends an `x-amz-acl` header.** flydrive's S3 driver sets `ACL: 'public-read' | 'private'` on every put whenever `supportsACL` is true — the default. `resolveStorage` forwards only `{ bucket, region, endpoint, visibility }` (`packages/core/src/storage/resolve.ts:119-131`), so there is no way to turn it off. R2 does not implement object ACLs; flydrive's own typings say `supportsACL` _must_ be `false` for R2. `.public()` collections therefore fail on upload of the original (`pipeline/file-adder.ts:133`), every conversion (`conversions/engine.ts:345`), and every responsive variant (`conversions/engine.ts:198`).

2. **`url()` returns a dead link, silently.** `DefaultUrlGenerator.publicUrlFor` honors `baseUrl` only for `driver === 'fs'` (`packages/core/src/storage/url-generator.ts:98-115`); for `s3` it delegates to `disk.getUrl()`, which builds `endpoint + /bucket/key`. On R2 that is the authenticated S3 API host, which never serves anonymous GETs. `url()`, `firstUrl()`, `responsiveUrl()`, and `srcset()` all return URLs that 401. No error is thrown.

A third defect blocks S3 generally: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are optional peers of flydrive, but `packages/core/package.json` declares neither and neither is installed in this repo. A user who configures `driver: 's3'` gets a bare module-resolution error with no guidance from any README.

Everything needed to fix this already exists inside flydrive. Core simply does not forward it.

## 2. Scope

In scope:

- A `driver: 'r2'` config discriminant with R2-correct defaults and config-time validation.
- A widened `driver: 's3'` variant (`supportsACL`, `credentials`, `forcePathStyle`, `requestChecksumCalculation`), which `'r2'` normalizes into.
- Uniform `baseUrl` consumption across all drivers, retiring a documented known limitation.
- Optional AWS SDK peer dependencies on core.
- Env-var synthesis for R2.
- A shared storage-cycle test contract, exercised against MinIO in CI and against real R2 when credentials are present.
- Documentation across core README, root README, and the docs site.

Out of scope:

- Forwarding flydrive's `cdnUrl` option (see §4.3 for why it is deliberately not exposed).
- Server-side `CopyObject`, multipart uploads, or any change to the ingestion pipeline. `copyMedia` deliberately re-runs the add pipeline (`library.ts:487-509`), so R2's `CopyObject` constraints are irrelevant.
- A general storage-driver plugin seam. R2 is an S3 dialect, not a new driver family.

## 3. What already works on R2

Stated explicitly so the implementation does not "fix" things that are not broken. Core invokes only these flydrive `Disk` methods:

| Method         | Call sites                                              | R2 status                                      |
| -------------- | ------------------------------------------------------- | ---------------------------------------------- |
| `put`          | `file-adder.ts:133`, `engine.ts:198`, `engine.ts:345`   | **Broken** — ACL header (§4.1)                 |
| `getUrl`       | `url-generator.ts:108`                                  | **Broken** — dead public URL (§4.3)            |
| `getStream`    | `library.ts:496`, `library.ts:603`, `library.ts:657`    | OK — plain `GetObject`                         |
| `getBytes`     | `engine.ts:268`                                         | OK                                             |
| `delete`       | `engine.ts:224`, `library.ts:840`, `library.ts:861`     | OK                                             |
| `deleteAll`    | `library.ts:455`, `library.ts:458`, `file-adder.ts:151` | OK — `ListObjectsV2` + batched `DeleteObjects` |
| `listAll`      | `library.ts:711`                                        | OK — `ListObjectsV2` pagination                |
| `getSignedUrl` | `url-generator.ts:147`                                  | OK — SigV4 presigning                          |

Core never calls `copy`, `move`, `exists`, `getMetaData`, `getVisibility`, `setVisibility`, or `putStream`. This matters: flydrive's `copy()` issues `GetObjectAcl` when `supportsACL` is true, which R2 does not implement — but core never reaches it. The blast radius is confined to writes and public URLs.

flydrive 1.3.0 uses single `PutObject` calls with full buffers (no `@aws-sdk/lib-storage`), consistent with core's buffer-based pipeline. Downloads, ZIP streaming, `clean()`, and the conversions read-back are all pure `GetObject`/`List`/`Delete` traffic and need no changes.

## 4. Design

### 4.1 Config surface

`DiskConfig` gains a widened `s3` variant and a new `r2` discriminant:

```ts
export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export type DiskConfig =
  | { driver: 'fs'; root: string; visibility?: Visibility; baseUrl?: string }
  | {
      driver: 's3'
      bucket: string
      region?: string
      endpoint?: string
      credentials?: S3Credentials
      supportsACL?: boolean
      forcePathStyle?: boolean
      requestChecksumCalculation?: 'WHEN_SUPPORTED' | 'WHEN_REQUIRED'
      visibility?: Visibility
      baseUrl?: string
    }
  | {
      driver: 'r2'
      accountId: string
      bucket: string
      credentials?: S3Credentials
      endpoint?: string
      visibility?: Visibility
      baseUrl?: string
    }
  | { driver: 'gcs' /* unchanged */ }
```

The user-facing R2 config is therefore:

```ts
storage: {
  default: 'r2',
  disks: {
    r2: {
      driver: 'r2',
      accountId: 'abc123',
      bucket: 'my-media',
      credentials: { accessKeyId: '…', secretAccessKey: '…' },
      baseUrl: 'https://cdn.example.com', // required only for public collections
    },
  },
}
```

**`S3Credentials` is a locally-declared structural type, not an import from `@aws-sdk/client-s3`.** The AWS SDK is an optional peer; a type import would break `tsc` for every fs/gcs user who has not installed it. The shape is structurally compatible with the SDK's own credentials object, so it passes through unchanged.

`requestChecksumCalculation` is exposed but **deliberately left unset by the `r2` preset.** AWS SDK ≥3.729 defaults to `WHEN_SUPPORTED`, computing CRC32 on every `PutObject`, which historically broke non-AWS S3 endpoints. Cloudflare has since added CRC32 support to R2, but this repo installs no SDK today, so the claim is unverifiable from source. The live R2 suite (§4.6) settles it empirically. If `PutObject` fails there, the fix is a one-line default in the preset, backed by a test that proves it — rather than a workaround baked in on a guess.

### 4.2 Normalization: one code path

`resolveStorage`'s `disk()` factory normalizes an `r2` config into the widened `s3` shape **before** the `S3Driver` branch, so exactly one place constructs an S3 driver:

| `r2` input                                       | Normalized `s3` output                                   |
| ------------------------------------------------ | -------------------------------------------------------- |
| `accountId`                                      | `endpoint: https://{accountId}.r2.cloudflarestorage.com` |
| `endpoint` (given)                               | Used verbatim, overriding the derived value              |
| —                                                | `supportsACL: false` (forced, not defaulted)             |
| —                                                | `region: 'auto'`                                         |
| `bucket`, `credentials`, `visibility`, `baseUrl` | Passed through unchanged                                 |

An explicit `endpoint` override is required because R2's EU jurisdiction uses a different host than the derived default.

`supportsACL` is **forced** rather than defaulted: there is no valid R2 configuration with ACLs enabled, so accepting the option there would only let a user construct a broken disk.

`diskConfig()` continues to return the user's original config, unnormalized — it is what `publicUrlFor` and the validation pass read, and they need to see `driver: 'r2'`.

### 4.3 URL generation: unify on `baseUrl`

Delete the `config.driver === 'fs'` condition in `publicUrlFor` (`url-generator.ts:105`) so **all** drivers honor `baseUrl` through the existing trailing-slash-stripping join. `disk.getUrl()` remains the fallback when `baseUrl` is absent.

flydrive's `cdnUrl` is **not** forwarded, for three reasons:

1. `baseUrl` already exists on the `s3` and `gcs` config types and does nothing. Adding `cdnUrl` beside it would ship two options meaning "public URL base" — one working, one inert. That is a worse API than the current honest limitation.
2. flydrive builds public URLs with `new URL(key, cdnUrl)`, which silently drops the last path segment of a base that has a path and no trailing slash (`https://cdn.example.com/media` → `https://cdn.example.com/`). Core's existing join strips trailing slashes and concatenates, so it is not subject to this.
3. Core never calls `disk.getUrl()` anywhere except `publicUrlFor`, so forwarding `cdnUrl` would have no other effect.

This retires the "**`baseUrl` is accepted but unconsumed by the `s3`/`gcs` drivers**" known limitation (`packages/core/README.md:358, 416`) for `gcs` as a side effect — one fix, four drivers.

Signed URLs are untouched: `getSignedUrl` presigns against the real endpoint and must continue to, since `baseUrl` may point at a CDN that cannot validate a signature. `responsiveUrl`/`responsiveSignedUrl` inherit the fix automatically — both route through `publicUrlFor`. The `?v=` version suffix is plain string concatenation and composes unchanged.

Keys from `DefaultPathGenerator` never start with `/` (`storage/path-generator.ts:17-27`), so the storage `prefix` survives into the URL.

### 4.4 Fail-fast validation

A public collection on an R2 disk with no `baseUrl` can never produce a working URL. Rather than fail at request time in production, this throws at construction.

The check lives in the `MediaLibrary` constructor (`library.ts`), next to the existing hybrid-queue-driver guard (`library.ts:151`) — the same fail-at-construction pattern. It belongs there, not in `resolveStorage`, because it needs both the collection registry and the storage config, and only `resolveConfig`'s output has both. `resolveStorage` stays unaware of collections.

The pass walks every registered collection in `resolved.models`. `CollectionDefinition` already carries `public`, `disk`, and `conversionsDisk` (`definitions/collection.ts:10-12`). For each collection with `public: true`, it resolves the effective disk (`disk ?? default`, and `conversionsDisk ?? disk ?? default`) and throws `StorageError` when that disk is `driver: 'r2'` with no `baseUrl`, naming the collection and the disk.

Unregistered collections fall through `getCollectionDefinition()`'s zero-conversion default and are not public, so they need no check.

### 4.5 Mixed-visibility warning

On R2, "public" is a bucket-level property — an r2.dev subdomain or custom domain — not a per-object one. With `supportsACL: false`, `.public()` becomes a no-op at the storage layer. Consequently, a single R2 bucket hosting both public and private collections is incoherent: if the bucket has a public domain attached, the "private" objects are reachable by anyone who can derive the key.

Core cannot detect whether a public domain is actually attached; it only knows whether `baseUrl` is set. So this is a `console.warn` — worded in the style of the existing `PRODUCTION_FS_WARNING` (`resolve.ts:52`) — not a throw, emitted when an `r2` disk with `baseUrl` set is the effective disk for both a public and a non-public collection.

It is emitted from the same constructor validation pass as §4.4, **not** from `resolveStorage`. Detecting it requires comparing collections against each other, which is exactly the collection knowledge §4.4 keeps out of `resolveStorage`. The two checks share one walk of `resolved.models`. The message points at the two-disk pattern, which `useDisk()`/`conversionsDisk` already support (`definitions/collection.ts:94-99`).

What actually carries the weight on R2 is key unguessability: `DefaultPathGenerator` produces `prefix/{uuid}/{fileName}`. The Security model docs must say so, and must stop claiming ACLs are what makes storage private.

### 4.6 Testing

There is no shared storage contract today — `packages/core/src/testing/` holds only the repository and queue contracts. This adds a third, `storageCycleContract`, exported from the existing `./testing` entry point (no export-map change needed, since the entry already exists).

The contract runs one full lifecycle against a real backend: add → convert → responsive variants → `url()` → `signedUrl()` → `clean()` → delete. Three consumers:

| Suite             | Gate                                                                     | Proves                                               |
| ----------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| MinIO             | `S3_ENDPOINT`, new `minio` service in `ci.yml`                           | The `s3` path executes at all — today it never has   |
| Real R2           | `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | ACL suppression, CRC32 compatibility, r2.dev serving |
| Offline (ungated) | none                                                                     | Resolve-layer contract, no network                   |

The MinIO service container sits alongside the existing `redis:7` and `rabbitmq:4` in `.github/workflows/ci.yml:15-38` — same pattern, no new infrastructure concept, no secrets. It requires `forcePathStyle: true`, which is itself a reason to expose that option.

**MinIO cannot prove the R2-specific behavior.** It accepts ACLs, so it exercises neither the `supportsACL: false` path nor R2's checksum handling. This is stated in the docs rather than papered over. The real-R2 suite stays dormant until repository secrets are added, at which point it runs in CI as the authority — matching the convention that CI is authoritative for `REDIS_URL`/`AMQP_URL`-gated suites.

Per the binary-gated convention, each gated suite pairs with an ungated companion covering the env-missing path. The offline assertions cover: endpoint derivation from `accountId`, the explicit-`endpoint` override, `region: 'auto'`, `supportsACL: false` forcing, `baseUrl`-derived URLs including `prefix` and `?v=`, the fail-fast throw, and the mixed-visibility warning.

### 4.7 Env synthesis

`synthesizeDefaultDisk` (`resolve.ts:56-74`) gains an R2 branch checked **before** the `MEDIA_S3_*` branch, since `MEDIA_R2_ACCOUNT_ID` is the more specific signal:

| Variable                                               | Maps to                        |
| ------------------------------------------------------ | ------------------------------ |
| `MEDIA_R2_ACCOUNT_ID`                                  | `accountId` (triggers branch)  |
| `MEDIA_R2_BUCKET`                                      | `bucket` (required with above) |
| `MEDIA_R2_BASE_URL`                                    | `baseUrl`                      |
| `MEDIA_R2_ACCESS_KEY_ID`, `MEDIA_R2_SECRET_ACCESS_KEY` | `credentials`                  |

Resulting precedence, to be documented: R2 → S3 → GCS → fs. If `MEDIA_R2_ACCOUNT_ID` is set without `MEDIA_R2_BUCKET`, that is a misconfiguration and throws rather than silently falling through to the S3 or fs branch.

Credentials remain optional everywhere; when absent the AWS SDK's default provider chain applies, unchanged.

### 4.8 Packaging

`packages/core/package.json` gains optional peers mirroring the `@google-cloud/storage` treatment (`package.json:65-72`):

```jsonc
"peerDependencies": {
  "@google-cloud/storage": "^7.10.2",
  "@aws-sdk/client-s3": "^3.577.0",
  "@aws-sdk/s3-request-presigner": "^3.577.0"
},
"peerDependenciesMeta": {
  "@google-cloud/storage": { "optional": true },
  "@aws-sdk/client-s3": { "optional": true },
  "@aws-sdk/s3-request-presigner": { "optional": true }
}
```

Both also go into `devDependencies` so the suites can run. The range matches flydrive's own peer range. Note `.prettierignore` excludes `**/package.json` — this file is hand-formatted with compact single-line objects and must not be reformatted.

## 5. Documentation

Docs mismatches are defects in this repo, so these ship in the same PR:

- **`packages/core/README.md`** — config table; "Storage disks" (add R2 example and the AWS SDK install note, mirroring the GCS one); "URL building per driver" (the `baseUrl`-unconsumed bullet becomes false); "Security model" (the ACL claim is wrong on R2; add key-unguessability and the two-disk guidance); Roadmap "Known limitations" (retire the `baseUrl` bullet).
- **Root `README.md`** — the "fs/S3/GCS" backend list, the config table, the storage section, and the signed-URL note.
- **`website/src/content/docs/reference/configuration.mdx`** — env table, disk table, and the `urlGenerator` row, which currently says a custom CDN hostname requires a custom `UrlGenerator`. This change makes that false.
- **`website/src/content/docs/production/limitations.mdx`** — same `baseUrl` retirement.
- **`docs/superpowers/specs/2026-07-26-node-media-library-design.md`** — unchanged. It already claims R2 support; the code is catching up to the spec, not the reverse.
- A `feat(core)` changeset.

The generated `api/type-aliases/DiskConfig.md` regenerates from JSDoc — the new options need doc comments worth publishing.

## 6. Risks

| Risk                                                               | Mitigation                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRC32 checksums reject `PutObject` on R2                           | Escape hatch shipped; live suite decides the default (§4.1)                                                                                                                                                                                                                                                                             |
| `baseUrl` unification changes URLs for an existing `s3`/`gcs` user | Only affects users who set `baseUrl` today — where it currently does nothing, so any change is from broken to working. Called out in the changeset.                                                                                                                                                                                     |
| Real-R2 suite never runs because secrets are never added           | MinIO covers the wire protocol unconditionally; the gap is documented, not hidden                                                                                                                                                                                                                                                       |
| A new union member silently falls through to the GCS driver        | `resolveStorage`'s `disk()` uses `if (fs) … if (s3) …` and then treats everything remaining as GCS (`resolve.ts:131-146`) — no exhaustiveness check, so an unnormalized `r2` would construct a `GCSDriver` with no type error. §4.2's normalization must run before the branches, and the offline suite asserts the constructed driver. |

## 7. Success criteria

1. A user adopts R2 by writing a `driver: 'r2'` disk config and nothing else — no custom `UrlGenerator`, no `AWS_*` env vars, no flags to discover.
2. A public collection on a misconfigured R2 disk throws at construction, not at request time.
3. The `s3` code path executes in CI for the first time.
4. `pnpm -r typecheck`, `pnpm -r test`, and `pnpm format:check` pass; no doc claims exceed shipped behavior.
