# Cloudflare R2 Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cloudflare R2 adoptable through configuration alone — a `driver: 'r2'` disk config and nothing else — while closing the adjacent gaps that leave the existing `s3` driver uninstallable and untested.

**Architecture:** Widen the existing `s3` variant of `DiskConfig` with the four flydrive options core never forwarded, then add an `r2` discriminant that normalizes into that widened shape *before* the driver-construction branches run, so exactly one code path builds an `S3Driver`. Public URLs unify on the existing `baseUrl` option across all drivers rather than exposing flydrive's `cdnUrl`. A construction-time validation pass rejects configurations that could only fail later at request time.

**Tech Stack:** TypeScript 6 (ESM), flydrive 1.3.0, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (new optional peers), vitest, pnpm workspaces, GitHub Actions service containers.

**Spec:** `docs/superpowers/specs/2026-08-10-cloudflare-r2-support-design.md`

## Global Constraints

- **ESM with explicit extensions.** Every relative import carries a `.js` suffix even in TypeScript source: `import { x } from './thing.js'`.
- **Prettier**, configured under the `prettier` key in the root `package.json`: no semicolons, single quotes, 2-space indent, 100 columns. CI gates on `pnpm format:check`.
- **`.prettierignore` excludes `**/package.json`** (hand-formatted with compact single-line objects) **and `docs/superpowers/plans`**. Never reformat either. This plan file is itself prettier-ignored.
- **Tests live in each package's `test/` directory**, never colocated in `src/`.
- **Tests hit real boundaries** — real temp files, real subprocess invocations, real network against real endpoints. Not mocks of those seams.
- **Pinned deps, do not bump:** `flydrive` stays `^1`, `@types/node` stays `^22`, `typescript` stays `^6`.
- **Dual export maps.** Adding an entry point means updating both `exports` (→ `src/*.ts`) and `publishConfig.exports` (→ `dist/*.js` + `dist/*.d.ts`). This plan adds **no** new entry points — `./testing` already exists.
- **Node floor is 22.** `pnpm` only; `npm publish`/`npm pack` deliberately fail via `prepack`.
- **Conventional Commits with a package scope**, minus the `@node-media-library/` prefix: `feat(core): …`, `fix(core): …`, `chore: …` for repo-wide.
- **Docs must match shipped behavior.** A README, spec, or JSDoc claim that over- or under-states what the code does is a defect, not a nitpick.
- **Branch:** `feat/cloudflare-r2-support`, already created, spec already committed as `076a344`.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/core/package.json` | Declares the AWS SDK optional peers + devDeps | 1 |
| `packages/core/src/storage/resolve.ts` | `S3Credentials`, widened `s3` variant, `r2` variant, `normalizeR2`, driver construction, env synthesis | 1, 2, 5 |
| `packages/core/src/storage/url-generator.ts` | Uniform `baseUrl` consumption in `publicUrlFor` | 3 |
| `packages/core/src/storage/visibility-check.ts` | **New.** Construction-time public-collection validation + mixed-visibility warning | 4 |
| `packages/core/src/library.ts` | Calls the visibility check from the constructor | 4 |
| `packages/core/src/testing/storage-contract.ts` | **New.** Shared backend lifecycle contract | 6 |
| `packages/core/src/testing/index.ts` | Re-exports the new contract | 6 |
| `packages/core/test/s3-disk.test.ts` | **New.** Offline `s3`/`r2` resolve assertions | 1, 2 |
| `packages/core/test/r2-visibility.test.ts` | **New.** Fail-fast + warning behavior | 4 |
| `packages/core/test/storage-minio.test.ts` | **New.** `S3_ENDPOINT`-gated contract run | 6 |
| `packages/core/test/storage-r2.test.ts` | **New.** `R2_ACCOUNT_ID`-gated contract run | 6 |
| `packages/core/test/storage-resolve.test.ts` | Extended with R2 env-synthesis cases | 5 |
| `packages/core/test/conversion-urls.test.ts` | Extended with `baseUrl`-on-s3 cases | 3 |
| `.github/workflows/ci.yml` | MinIO service container + new env | 6 |
| READMEs, `website/src/content/docs/**` | Documentation | 7 |

`visibility-check.ts` is a separate module rather than inline in `library.ts` because `library.ts` is already ~870 lines; the check is self-contained and independently testable.

---

### Task 1: AWS SDK peers and the widened `s3` variant

**Files:**
- Modify: `packages/core/package.json:65-72` (peers), devDependencies block
- Modify: `packages/core/src/storage/resolve.ts:17-40` (DiskConfig), `:119-131` (s3 branch)
- Test: `packages/core/test/s3-disk.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export interface S3Credentials { accessKeyId: string; secretAccessKey: string; sessionToken?: string }` from `src/storage/resolve.ts`. The `s3` member of `DiskConfig` gains `credentials?: S3Credentials`, `supportsACL?: boolean`, `forcePathStyle?: boolean`, `requestChecksumCalculation?: 'when_supported' | 'when_required'`. Task 2 normalizes into exactly this shape.

- [ ] **Step 1: Install the AWS SDK as devDependencies**

Do not hand-write version literals — let pnpm resolve current versions and record what it picks.

```bash
pnpm --filter @node-media-library/core add -D @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Declare them as optional peers**

Edit `packages/core/package.json`. The existing block reads:

```json
  "peerDependencies": {
    "@google-cloud/storage": "^7.10.2"
  },
  "peerDependenciesMeta": {
    "@google-cloud/storage": {
      "optional": true
    }
  },
```

Replace with (the `^3.577.0` range matches flydrive's own peer range for these packages):

```json
  "peerDependencies": {
    "@google-cloud/storage": "^7.10.2",
    "@aws-sdk/client-s3": "^3.577.0",
    "@aws-sdk/s3-request-presigner": "^3.577.0"
  },
  "peerDependenciesMeta": {
    "@google-cloud/storage": {
      "optional": true
    },
    "@aws-sdk/client-s3": {
      "optional": true
    },
    "@aws-sdk/s3-request-presigner": {
      "optional": true
    }
  },
```

**Do not run prettier on this file** — `.prettierignore` excludes `**/package.json`.

- [ ] **Step 3: Write the failing test**

Create `packages/core/test/s3-disk.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveStorage } from '../src/storage/resolve.js'

describe('s3 disk driver', () => {
  it('resolves an s3 disk to a flydrive Disk backed by S3Driver', async () => {
    const storage = resolveStorage({
      disks: {
        media: {
          driver: 's3',
          bucket: 'test-bucket',
          region: 'us-east-1',
          endpoint: 'https://s3.example.com',
          credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
        },
      },
      default: 'media',
    })
    const disk = await storage.disk('media')
    // getUrl is the observable driver contract and needs no live credentials:
    // with an endpoint configured, S3Driver builds `endpoint + /bucket/key`.
    const url = await disk.getUrl('some/key.png')
    expect(url).toBe('https://s3.example.com/test-bucket/some/key.png')
  })

  it('forwards supportsACL, forcePathStyle and credentials without throwing', async () => {
    const storage = resolveStorage({
      disks: {
        media: {
          driver: 's3',
          bucket: 'b',
          region: 'us-east-1',
          endpoint: 'https://minio.example.com',
          credentials: { accessKeyId: 'ak', secretAccessKey: 'sk', sessionToken: 'st' },
          supportsACL: false,
          forcePathStyle: true,
          requestChecksumCalculation: 'when_required',
        },
      },
      default: 'media',
    })
    const disk = await storage.disk('media')
    expect(await disk.getUrl('k.png')).toBe('https://minio.example.com/b/k.png')
  })

  it('memoizes the disk instance per name', async () => {
    const storage = resolveStorage({
      disks: { media: { driver: 's3', bucket: 'b', region: 'us-east-1' } },
      default: 'media',
    })
    expect(await storage.disk('media')).toBe(await storage.disk('media'))
  })
})
```

- [ ] **Step 4: Run it to make sure it fails**

```bash
pnpm --filter @node-media-library/core test s3-disk
```

Expected: FAIL. The second test fails to typecheck/run because `supportsACL`, `forcePathStyle`, `requestChecksumCalculation`, and `credentials` are not members of the `s3` config type.

- [ ] **Step 5: Widen the config type**

In `packages/core/src/storage/resolve.ts`, above `export type DiskConfig`, add:

```ts
/**
 * Static S3 credentials. Declared structurally rather than imported from
 * `@aws-sdk/client-s3`, which is an *optional* peer — a type import would
 * break `tsc` for every fs/gcs consumer who never installed the AWS SDK.
 * The shape is structurally compatible with the SDK's own credentials
 * object, so it passes through unchanged.
 */
export interface S3Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}
```

Then replace the `s3` member of `DiskConfig` with:

```ts
  | {
      driver: 's3'
      bucket: string
      region?: string
      endpoint?: string
      /** Static credentials. Omit to use the AWS SDK's default provider chain. */
      credentials?: S3Credentials
      /**
       * Whether the backend implements object ACLs. Leave unset for AWS S3.
       * Set `false` for backends without ACL support — flydrive then skips the
       * `x-amz-acl` header on every write. Cloudflare R2 requires `false`;
       * `driver: 'r2'` forces it for you.
       */
      supportsACL?: boolean
      /** Path-style addressing (`host/bucket/key`). Required by MinIO. */
      forcePathStyle?: boolean
      /**
       * Passed through to the AWS SDK. SDK versions from 3.729 default to
       * `'when_supported'`, computing a CRC32 checksum on every PutObject,
       * which some S3-compatible backends reject. Set `'when_required'` if a
       * backend rejects checksummed writes.
       */
      requestChecksumCalculation?: 'when_supported' | 'when_required'
      visibility?: 'public' | 'private'
      baseUrl?: string
    }
```

- [ ] **Step 6: Forward the new options to the driver**

Replace the `s3` branch body in `disk()` (currently `resolve.ts:119-131`):

```ts
    if (cfg.driver === 's3') {
      const { S3Driver } = await import('flydrive/drivers/s3')
      const instance = new DiskCtor(
        new S3Driver({
          bucket: cfg.bucket,
          region: cfg.region,
          endpoint: cfg.endpoint,
          visibility: cfg.visibility ?? 'private',
          // Spread conditionally rather than passing `undefined`: an explicit
          // `credentials: undefined` is fine for the SDK, but the same is not
          // true of every option here, and this matches the gcs branch's style.
          ...(cfg.credentials ? { credentials: cfg.credentials } : {}),
          ...(cfg.supportsACL !== undefined ? { supportsACL: cfg.supportsACL } : {}),
          ...(cfg.forcePathStyle !== undefined ? { forcePathStyle: cfg.forcePathStyle } : {}),
          ...(cfg.requestChecksumCalculation
            ? { requestChecksumCalculation: cfg.requestChecksumCalculation }
            : {}),
        }),
      )
      cache.set(diskName, instance)
      return instance
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @node-media-library/core test s3-disk
```

Then:

```bash
pnpm -r typecheck
```

Expected: PASS, no type errors.

- [ ] **Step 8: Run the full suite for regressions**

```bash
pnpm --filter @node-media-library/core test
```

Expected: PASS. Nothing here changes existing behavior — every new option is optional and unset by default.

- [ ] **Step 9: Commit**

```bash
git add packages/core/package.json packages/core/src/storage/resolve.ts packages/core/test/s3-disk.test.ts pnpm-lock.yaml
git commit -m "feat(core): declare AWS SDK peers and widen the s3 disk config"
```

---

### Task 2: The `r2` discriminant and normalization

**Files:**
- Modify: `packages/core/src/storage/resolve.ts` (DiskConfig, new `normalizeR2`, `disk()` branch routing)
- Test: `packages/core/test/s3-disk.test.ts` (extend)

**Interfaces:**
- Consumes: `S3Credentials` and the widened `s3` variant from Task 1.
- Produces: the `r2` member of `DiskConfig` — `{ driver: 'r2'; accountId: string; bucket: string; credentials?: S3Credentials; endpoint?: string; visibility?: 'public' | 'private'; baseUrl?: string }` — and `export function normalizeR2(cfg): Extract<DiskConfig, { driver: 's3' }>`. Task 4 reads `driver === 'r2'` off the **un-normalized** config via `diskConfig()`; Task 5 synthesizes this shape from env.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/s3-disk.test.ts`:

```ts
describe('r2 disk driver', () => {
  it('derives the R2 endpoint from accountId', async () => {
    const storage = resolveStorage({
      disks: { media: { driver: 'r2', accountId: 'acct123', bucket: 'my-media' } },
      default: 'media',
    })
    const disk = await storage.disk('media')
    expect(await disk.getUrl('k.png')).toBe(
      'https://acct123.r2.cloudflarestorage.com/my-media/k.png',
    )
  })

  it('an explicit endpoint overrides the derived one (EU jurisdiction)', async () => {
    const storage = resolveStorage({
      disks: {
        media: {
          driver: 'r2',
          accountId: 'acct123',
          bucket: 'my-media',
          endpoint: 'https://acct123.eu.r2.cloudflarestorage.com',
        },
      },
      default: 'media',
    })
    const disk = await storage.disk('media')
    expect(await disk.getUrl('k.png')).toBe(
      'https://acct123.eu.r2.cloudflarestorage.com/my-media/k.png',
    )
  })

  it('diskConfig() returns the un-normalized r2 config', () => {
    const storage = resolveStorage({
      disks: { media: { driver: 'r2', accountId: 'a', bucket: 'b', baseUrl: 'https://cdn.x' } },
      default: 'media',
    })
    // The URL generator and the visibility check both branch on `driver: 'r2'`,
    // so normalization must not leak into what diskConfig() reports.
    expect(storage.diskConfig('media')).toMatchObject({ driver: 'r2', accountId: 'a' })
  })

  it('normalizeR2 forces supportsACL off and region auto', () => {
    expect(
      normalizeR2({
        driver: 'r2',
        accountId: 'a',
        bucket: 'b',
        credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
        baseUrl: 'https://cdn.x',
      }),
    ).toEqual({
      driver: 's3',
      bucket: 'b',
      region: 'auto',
      endpoint: 'https://a.r2.cloudflarestorage.com',
      supportsACL: false,
      visibility: 'private',
      credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
      baseUrl: 'https://cdn.x',
    })
  })

  it('an unknown driver throws instead of silently building a GCS disk', async () => {
    const storage = resolveStorage({
      // Cast: the point of this test is the runtime guard behind the type.
      disks: { media: { driver: 'nope' } as never },
      default: 'media',
    })
    await expect(storage.disk('media')).rejects.toThrow(/unsupported disk driver/i)
  })
})
```

Update the import at the top of the file:

```ts
import { normalizeR2, resolveStorage } from '../src/storage/resolve.js'
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
pnpm --filter @node-media-library/core test s3-disk
```

Expected: FAIL — `normalizeR2` is not exported, and `driver: 'r2'` is not a member of `DiskConfig`.

- [ ] **Step 3: Add the `r2` variant to `DiskConfig`**

In `packages/core/src/storage/resolve.ts`, add this member to the `DiskConfig` union, after the `s3` member:

```ts
  | {
      driver: 'r2'
      /** Cloudflare account ID. Derives the S3 API endpoint. */
      accountId: string
      bucket: string
      /** Static R2 credentials. Omit to use the AWS SDK's default provider chain. */
      credentials?: S3Credentials
      /**
       * Overrides the endpoint derived from `accountId`. Needed for R2's EU
       * jurisdiction, whose host differs from the default.
       */
      endpoint?: string
      visibility?: 'public' | 'private'
      /**
       * Public URL base — an `https://pub-….r2.dev` subdomain or a custom
       * domain. R2 has no object ACLs, so this is the *only* way to produce
       * working public URLs; a `.public()` collection on an r2 disk without
       * it throws when the MediaLibrary is constructed.
       */
      baseUrl?: string
    }
```

- [ ] **Step 4: Implement `normalizeR2`**

Add above `resolveStorage`:

```ts
/**
 * Normalizes an `r2` disk config into the `s3` shape the driver branch
 * consumes, so exactly one code path constructs an S3Driver.
 *
 * `supportsACL` is *forced* rather than defaulted: R2 does not implement
 * object ACLs, so there is no valid R2 configuration with them enabled, and
 * accepting the option would only let a caller build a broken disk.
 *
 * `requestChecksumCalculation` is deliberately left unset — the AWS SDK's
 * own default applies until the live R2 suite proves it needs overriding.
 * @internal
 */
export function normalizeR2(
  cfg: Extract<DiskConfig, { driver: 'r2' }>,
): Extract<DiskConfig, { driver: 's3' }> {
  return {
    driver: 's3',
    bucket: cfg.bucket,
    region: 'auto',
    endpoint: cfg.endpoint ?? `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    supportsACL: false,
    visibility: cfg.visibility ?? 'private',
    ...(cfg.credentials ? { credentials: cfg.credentials } : {}),
    ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
  }
}
```

- [ ] **Step 5: Route `r2` through normalization, and close the GCS fallthrough**

In `disk()`, the line that reads `const cfg = diskConfig(diskName)` becomes:

```ts
    // Normalize before the branches below: `disk()` used to treat "not fs and
    // not s3" as gcs, so an unnormalized r2 config would have constructed a
    // GCSDriver with no type error at all.
    const raw = diskConfig(diskName)
    const cfg = raw.driver === 'r2' ? normalizeR2(raw) : raw
```

Then change the trailing GCS block from an unguarded fallthrough into an explicit branch. The block currently begins:

```ts
    const { GCSDriver } = await import('flydrive/drivers/gcs')
```

Guard it and add a terminal throw. Replace from that line to the end of `disk()`'s body with:

```ts
    if (cfg.driver === 'gcs') {
      const { GCSDriver } = await import('flydrive/drivers/gcs')
      const {
        bucket,
        visibility = 'private',
        usingUniformAcl,
        projectId,
        keyFilename,
        credentials,
      } = cfg
      const instance = new DiskCtor(
        new GCSDriver({
          bucket,
          visibility,
          ...(usingUniformAcl !== undefined ? { usingUniformAcl } : {}),
          ...(projectId ? { projectId } : {}),
          ...(keyFilename ? { keyFilename } : {}),
          ...(credentials ? { credentials } : {}),
        }),
      )
      cache.set(diskName, instance)
      return instance
    }

    throw new StorageError(
      `Unsupported disk driver "${(cfg as { driver: string }).driver}" on disk "${diskName}"`,
    )
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @node-media-library/core test s3-disk
```

Then confirm GCS did not regress, since its branch just changed shape:

```bash
pnpm --filter @node-media-library/core test gcs-disk
```

Expected: PASS for both files.

- [ ] **Step 7: Run the full suite and typecheck**

```bash
pnpm --filter @node-media-library/core test
```

Then:

```bash
pnpm -r typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/storage/resolve.ts packages/core/test/s3-disk.test.ts
git commit -m "feat(core): add a driver: 'r2' disk config for Cloudflare R2"
```

---

### Task 3: Uniform `baseUrl` across all drivers

**Files:**
- Modify: `packages/core/src/storage/url-generator.ts:98-115` (`publicUrlFor`)
- Test: `packages/core/test/conversion-urls.test.ts` (extend)

**Interfaces:**
- Consumes: the `r2` and widened `s3` variants from Tasks 1-2.
- Produces: no new exports. Behavior change only — `DefaultUrlGenerator.url()`, `responsiveUrl()`, and everything routing through them now honor `baseUrl` on every driver.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/conversion-urls.test.ts`:

```ts
describe('baseUrl is honored on every driver', () => {
  const fakeMedia = () =>
    ({
      id: 'abc',
      fileName: 'cat.png',
      disk: 'default',
      conversionsDisk: null,
      generatedConversions: {},
      updatedAt: new Date(0),
    }) as never

  it('an s3 disk with baseUrl builds URLs from it, not from the endpoint', async () => {
    const library = createMediaLibrary({
      repository: new InMemoryMediaRepository(),
      storage: {
        prefix: 'media',
        disks: {
          default: {
            driver: 's3',
            bucket: 'b',
            region: 'us-east-1',
            endpoint: 'https://s3.example.com',
            baseUrl: 'https://cdn.example.com',
          },
        },
      },
      models: {},
    })
    expect(await library.urlGenerator.url(fakeMedia())).toBe(
      'https://cdn.example.com/media/abc/cat.png',
    )
  })

  it('an r2 disk with baseUrl builds public URLs from it, trailing slash stripped', async () => {
    const library = createMediaLibrary({
      repository: new InMemoryMediaRepository(),
      storage: {
        disks: {
          default: {
            driver: 'r2',
            accountId: 'acct',
            bucket: 'b',
            // flydrive's own `new URL(key, cdnUrl)` would mangle a base like
            // this; core's join does not.
            baseUrl: 'https://cdn.example.com/',
          },
        },
      },
      models: {},
    })
    expect(await library.urlGenerator.url(fakeMedia())).toBe('https://cdn.example.com/abc/cat.png')
  })

  it('a baseUrl with a path segment keeps that segment', async () => {
    const library = createMediaLibrary({
      repository: new InMemoryMediaRepository(),
      storage: {
        disks: {
          default: { driver: 'r2', accountId: 'acct', bucket: 'b', baseUrl: 'https://cdn.x/assets' },
        },
      },
      models: {},
    })
    expect(await library.urlGenerator.url(fakeMedia())).toBe('https://cdn.x/assets/abc/cat.png')
  })
})
```

Ensure the file's imports include both of these; add whichever is missing:

```ts
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
pnpm --filter @node-media-library/core test conversion-urls
```

Expected: FAIL. The s3 and r2 cases return `https://s3.example.com/b/...` and `https://acct.r2.cloudflarestorage.com/b/...` because `publicUrlFor` short-circuits on `baseUrl` only for `driver === 'fs'`.

- [ ] **Step 3: Drop the `fs`-only condition**

In `packages/core/src/storage/url-generator.ts`, the body of `publicUrlFor` currently opens:

```ts
    const config = this.storage.diskConfig(diskName)

    if (config.driver === 'fs' && config.baseUrl) {
```

Replace that `if` line with:

```ts
    // Every driver honors `baseUrl`, not just fs. On r2 it is the only way to
    // build a working public URL at all (no object ACLs — public access comes
    // from an r2.dev subdomain or a custom domain), and on s3/gcs it is what
    // points at a CDN in front of the bucket. Signed URLs deliberately do NOT
    // route through here: they must presign against the real endpoint.
    if (config.baseUrl) {
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @node-media-library/core test conversion-urls
```

Expected: PASS.

- [ ] **Step 5: Run the full suite for regressions**

```bash
pnpm --filter @node-media-library/core test
```

Expected: PASS. Watch `responsive-urls.test.ts`, `downloads.test.ts`, and `copy-move.test.ts` — they use fs disks with `baseUrl`, whose behavior is unchanged, so any failure there means the join was altered rather than just its guard.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/storage/url-generator.ts packages/core/test/conversion-urls.test.ts
git commit -m "feat(core): honor baseUrl on every disk driver, not just fs"
```

---

### Task 4: Construction-time visibility validation

**Files:**
- Create: `packages/core/src/storage/visibility-check.ts`
- Modify: `packages/core/src/library.ts` (constructor, after `resolveConfig`)
- Test: `packages/core/test/r2-visibility.test.ts` (create)

**Interfaces:**
- Consumes: the `r2` variant from Task 2; `diskConfig()` returning un-normalized configs.
- Produces: `export function checkCollectionVisibility(models: Readonly<Record<string, Readonly<Record<string, CollectionDefinition>>>>, storage: ResolvedStorage): void` — throws `StorageError`, or emits a `console.warn`. No return value.

- [ ] **Step 1: Confirm the builder method names before writing tests**

```bash
grep -n "useDisk\|useConversionsDisk\|conversionsDisk" packages/core/src/definitions/collection.ts
```

Use the real method names in Step 2 wherever they differ from `useDisk` / `useConversionsDisk`.

- [ ] **Step 2: Write the failing tests**

Create `packages/core/test/r2-visibility.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'
import { collection } from '../src/definitions/collection.js'
import { StorageError } from '../src/errors.js'

afterEach(() => vi.restoreAllMocks())

const r2 = (baseUrl?: string) => ({
  driver: 'r2' as const,
  accountId: 'acct',
  bucket: 'b',
  ...(baseUrl ? { baseUrl } : {}),
})

describe('public collections on r2 disks', () => {
  it('throws when a public collection targets an r2 disk with no baseUrl', () => {
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: r2() } },
        models: { post: { collections: { images: collection().public() } } },
      }),
    ).toThrow(StorageError)
  })

  it('names the collection, the model and the disk in the error', () => {
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: r2() } },
        models: { post: { collections: { images: collection().public() } } },
      }),
    ).toThrow(/"images".*"post".*"default"/s)
  })

  it('accepts a public collection when baseUrl is set', () => {
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: r2('https://cdn.example.com') } },
        models: { post: { collections: { images: collection().public() } } },
      }),
    ).not.toThrow()
  })

  it('catches a public collection whose conversionsDisk is the bare r2 disk', () => {
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { cdn: r2('https://cdn.example.com'), raw: r2() }, default: 'cdn' },
        models: {
          post: { collections: { images: collection().public().useConversionsDisk('raw') } },
        },
      }),
    ).toThrow(StorageError)
  })

  it('leaves private collections on a bare r2 disk alone', () => {
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: r2() } },
        models: { post: { collections: { images: collection() } } },
      }),
    ).not.toThrow()
  })

  it('warns when one r2 disk with baseUrl serves both public and private collections', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createMediaLibrary({
      repository: new InMemoryMediaRepository(),
      storage: { disks: { default: r2('https://cdn.example.com') } },
      models: { post: { collections: { images: collection().public(), docs: collection() } } },
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[media-library]'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('default'))
  })

  it('does not warn when public and private live on separate r2 disks', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    createMediaLibrary({
      repository: new InMemoryMediaRepository(),
      storage: { disks: { pub: r2('https://cdn.example.com'), priv: r2() }, default: 'priv' },
      models: {
        post: { collections: { images: collection().public().useDisk('pub'), docs: collection() } },
      },
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('ignores collections pointing at a disk name that is not configured', () => {
    // diskConfig() throws for unknown names. That is a pre-existing runtime
    // failure mode this check must not convert into a construction failure.
    expect(() =>
      createMediaLibrary({
        repository: new InMemoryMediaRepository(),
        storage: { disks: { default: r2('https://cdn.example.com') } },
        models: { post: { collections: { images: collection().useDisk('nonexistent') } } },
      }),
    ).not.toThrow()
  })
})
```

- [ ] **Step 3: Run them to make sure they fail**

```bash
pnpm --filter @node-media-library/core test r2-visibility
```

Expected: FAIL — nothing validates yet, so the throwing cases construct successfully and the warning cases never call `console.warn`.

- [ ] **Step 4: Write the check module**

Create `packages/core/src/storage/visibility-check.ts`:

```ts
import type { CollectionDefinition } from '../definitions/collection.js'
import { StorageError } from '../errors.js'
import type { DiskConfig, ResolvedStorage } from './resolve.js'

const MIXED_VISIBILITY_WARNING =
  '[media-library] R2 disk "%s" has a baseUrl and serves both public and private collections. ' +
  'R2 has no per-object ACLs — if the bucket is reachable through a public domain, the ' +
  '"private" objects on it are too. Use two disks: a public bucket for .public() collections ' +
  'and a private bucket for the rest (see collection().useDisk()).'

/**
 * Resolves a disk config by name, or `null` when the name is not configured.
 * An unconfigured disk name is a pre-existing runtime failure mode; this
 * check must not upgrade it into a construction failure, which would break
 * consumers whose unused collections reference disks they never defined.
 */
function configOrNull(storage: ResolvedStorage, name: string): DiskConfig | null {
  try {
    return storage.diskConfig(name)
  } catch {
    return null
  }
}

/**
 * Rejects, at construction, configurations whose public URLs could only fail
 * later at request time, and warns about R2 disks whose visibility model is
 * incoherent.
 *
 * Lives here rather than in `resolveStorage` because it needs the collection
 * registry, and `resolveStorage` is deliberately unaware of collections.
 * @internal
 */
export function checkCollectionVisibility(
  models: Readonly<Record<string, Readonly<Record<string, CollectionDefinition>>>>,
  storage: ResolvedStorage,
): void {
  const publicDisks = new Set<string>()
  const privateDisks = new Set<string>()

  for (const [modelType, collections] of Object.entries(models)) {
    for (const [collectionName, def] of Object.entries(collections)) {
      const primary = def.disk ?? storage.defaultDisk
      const conversions = def.conversionsDisk ?? primary
      for (const diskName of new Set([primary, conversions])) {
        const cfg = configOrNull(storage, diskName)
        if (!cfg) continue
        if (!def.public) {
          privateDisks.add(diskName)
          continue
        }
        publicDisks.add(diskName)
        if (cfg.driver === 'r2' && !cfg.baseUrl) {
          throw new StorageError(
            `Collection "${collectionName}" on model "${modelType}" is public, but its disk ` +
              `"${diskName}" is an r2 disk with no baseUrl. Cloudflare R2 has no object ACLs — ` +
              `public URLs come from an r2.dev subdomain or a custom domain. Set baseUrl on the ` +
              `disk, or drop .public() and serve the files with signedUrl().`,
          )
        }
      }
    }
  }

  for (const diskName of publicDisks) {
    if (!privateDisks.has(diskName)) continue
    const cfg = configOrNull(storage, diskName)
    if (cfg?.driver === 'r2' && cfg.baseUrl) {
      console.warn(MIXED_VISIBILITY_WARNING.replace('%s', diskName))
    }
  }
}
```

- [ ] **Step 5: Call it from the constructor**

In `packages/core/src/library.ts`, add the import alongside the other storage imports:

```ts
import { checkCollectionVisibility } from './storage/visibility-check.js'
```

Then, in the `MediaLibrary` constructor, immediately after `this.resolved = resolveConfig(config)`:

```ts
    // Fail before anything is wired: a public collection on an r2 disk with no
    // baseUrl can never produce a working URL, and finding that out at request
    // time means a customer hits the dead link first.
    checkCollectionVisibility(this.resolved.models, this.resolved.storage)
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
pnpm --filter @node-media-library/core test r2-visibility
```

Expected: PASS, all eight cases.

- [ ] **Step 7: Run the full suite for regressions**

```bash
pnpm --filter @node-media-library/core test
```

Then:

```bash
pnpm -r typecheck
```

Expected: PASS. This adds a constructor-time throw, so any existing test registering a public collection on an r2 disk would now fail — there are none today, but confirm rather than assume.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/storage/visibility-check.ts packages/core/src/library.ts packages/core/test/r2-visibility.test.ts
git commit -m "feat(core): reject public collections on r2 disks with no baseUrl"
```

---

### Task 5: Env-var synthesis for R2

**Files:**
- Modify: `packages/core/src/storage/resolve.ts:56-74` (`synthesizeDefaultDisk`)
- Test: `packages/core/test/storage-resolve.test.ts` (extend)

**Interfaces:**
- Consumes: the `r2` variant from Task 2.
- Produces: no new exports. `synthesizeDefaultDisk` gains an R2 branch ahead of the S3 branch; precedence becomes R2 → S3 → GCS → fs.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/storage-resolve.test.ts`:

```ts
describe('R2 env synthesis', () => {
  it('MEDIA_R2_ACCOUNT_ID + MEDIA_R2_BUCKET synthesize a private r2 default disk', () => {
    const s = resolveStorage(undefined, {
      MEDIA_R2_ACCOUNT_ID: 'acct',
      MEDIA_R2_BUCKET: 'env-bucket',
    })
    expect(s.diskConfig()).toMatchObject({
      driver: 'r2',
      accountId: 'acct',
      bucket: 'env-bucket',
      visibility: 'private',
    })
  })

  it('MEDIA_R2_BASE_URL and credentials come through', () => {
    const s = resolveStorage(undefined, {
      MEDIA_R2_ACCOUNT_ID: 'acct',
      MEDIA_R2_BUCKET: 'b',
      MEDIA_R2_BASE_URL: 'https://cdn.example.com',
      MEDIA_R2_ACCESS_KEY_ID: 'ak',
      MEDIA_R2_SECRET_ACCESS_KEY: 'sk',
    })
    expect(s.diskConfig()).toMatchObject({
      baseUrl: 'https://cdn.example.com',
      credentials: { accessKeyId: 'ak', secretAccessKey: 'sk' },
    })
  })

  it('R2 wins over S3 and GCS', () => {
    const s = resolveStorage(undefined, {
      MEDIA_R2_ACCOUNT_ID: 'acct',
      MEDIA_R2_BUCKET: 'r2b',
      MEDIA_S3_BUCKET: 's3b',
      MEDIA_GCS_BUCKET: 'gcsb',
    })
    expect(s.diskConfig()).toMatchObject({ driver: 'r2', bucket: 'r2b' })
  })

  it('MEDIA_R2_ACCOUNT_ID without MEDIA_R2_BUCKET throws instead of falling through', () => {
    expect(() => resolveStorage(undefined, { MEDIA_R2_ACCOUNT_ID: 'acct' })).toThrow(
      /MEDIA_R2_BUCKET/,
    )
  })

  it('credentials are omitted unless both halves are present', () => {
    const s = resolveStorage(undefined, {
      MEDIA_R2_ACCOUNT_ID: 'acct',
      MEDIA_R2_BUCKET: 'b',
      MEDIA_R2_ACCESS_KEY_ID: 'ak',
    })
    expect(s.diskConfig()).not.toHaveProperty('credentials')
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

```bash
pnpm --filter @node-media-library/core test storage-resolve
```

Expected: FAIL — the R2 env vars are ignored and synthesis falls through to fs.

- [ ] **Step 3: Add the R2 branch**

In `packages/core/src/storage/resolve.ts`, insert at the top of `synthesizeDefaultDisk`'s body, **before** the `MEDIA_S3_BUCKET` check:

```ts
  if (env.MEDIA_R2_ACCOUNT_ID) {
    if (!env.MEDIA_R2_BUCKET) {
      throw new StorageError(
        'MEDIA_R2_ACCOUNT_ID is set without MEDIA_R2_BUCKET. Set both, or unset both — falling ' +
          'through to another driver here would silently store media somewhere you did not mean.',
      )
    }
    return {
      driver: 'r2',
      accountId: env.MEDIA_R2_ACCOUNT_ID,
      bucket: env.MEDIA_R2_BUCKET,
      visibility: 'private',
      ...(env.MEDIA_R2_BASE_URL ? { baseUrl: env.MEDIA_R2_BASE_URL } : {}),
      ...(env.MEDIA_R2_ACCESS_KEY_ID && env.MEDIA_R2_SECRET_ACCESS_KEY
        ? {
            credentials: {
              accessKeyId: env.MEDIA_R2_ACCESS_KEY_ID,
              secretAccessKey: env.MEDIA_R2_SECRET_ACCESS_KEY,
            },
          }
        : {}),
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @node-media-library/core test storage-resolve
```

Then confirm the pre-existing precedence assertions still hold:

```bash
pnpm --filter @node-media-library/core test gcs-disk
```

Expected: PASS. `gcs-disk.test.ts` asserts S3-over-GCS precedence and must stay green.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
pnpm --filter @node-media-library/core test
```

Then:

```bash
pnpm -r typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/storage/resolve.ts packages/core/test/storage-resolve.test.ts
git commit -m "feat(core): synthesize an r2 default disk from MEDIA_R2_* env vars"
```

---

### Task 6: Shared storage contract, MinIO in CI, gated R2 suite

**Files:**
- Create: `packages/core/src/testing/storage-contract.ts`
- Modify: `packages/core/src/testing/index.ts`
- Create: `packages/core/test/storage-minio.test.ts`, `packages/core/test/storage-r2.test.ts`
- Modify: `.github/workflows/ci.yml:14-38`

**Interfaces:**
- Consumes: every config shape from Tasks 1-5.
- Produces: `export function runStorageCycleContract(name: string, opts: { disk: DiskConfig; publicBaseUrl?: string }): void` from `@node-media-library/core/testing`.

- [ ] **Step 1: Confirm the API names the contract will call**

```bash
grep -n "async all\|async findById" packages/core/src/repository/in-memory.ts
grep -n "async deleteMedia" packages/core/src/library.ts
grep -n "  width(" packages/core/src/definitions/conversion.ts
```

Correct Step 2's code wherever a name differs. These are the only identifiers in this plan not already read from source.

- [ ] **Step 2: Write the contract**

Create `packages/core/src/testing/storage-contract.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import sharp from 'sharp'
import { createMediaLibrary } from '../library.js'
import { InMemoryMediaRepository } from '../repository/in-memory.js'
import { collection } from '../definitions/collection.js'
import { conversion } from '../definitions/conversion.js'
import type { DiskConfig } from '../storage/resolve.js'

/**
 * One full lifecycle against a real storage backend: add -> convert ->
 * signedUrl -> read back -> delete. Shared so MinIO and Cloudflare R2 are held
 * to identical behavior rather than drifting into two hand-written suites.
 *
 * `opts.publicBaseUrl` opts the run into the public-URL assertion. Omit it for
 * a backend with no public domain attached; the private path (signed URLs) is
 * exercised either way.
 */
export function runStorageCycleContract(
  name: string,
  opts: { disk: DiskConfig; publicBaseUrl?: string },
): void {
  describe(`storage cycle contract: ${name}`, () => {
    // A unique prefix per run so concurrent CI jobs sharing one bucket cannot
    // collide, and so cleanup is scoped to what this run created.
    const prefix = `nml-test/${name.replace(/\W+/g, '-')}/${process.pid}-${Date.now()}`
    const repo = new InMemoryMediaRepository()
    const library = createMediaLibrary({
      repository: repo,
      storage: { prefix, disks: { default: opts.disk }, default: 'default' },
      models: {
        post: { collections: { files: collection().conversions({ thumb: conversion().width(32) }) } },
      },
    })

    const png = () =>
      sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } })
        .png()
        .toBuffer()

    afterAll(async () => {
      // Best-effort: a failed assertion must not leave the bucket dirty, but a
      // cleanup failure must not mask the real error either.
      for (const media of await repo.all()) {
        await library.deleteMedia(media.id).catch(() => {})
      }
    })

    it('writes an original and reads it back byte-identically', async () => {
      const source = await png()
      const media = await library.for('post', '1').add(source).toCollection('files')
      const disk = await library.storage.disk(media.disk)
      const stored = await disk.getBytes(`${prefix}/${media.id}/${media.fileName}`)
      expect(Buffer.from(stored)).toEqual(source)
    })

    it('generates a conversion and records it', async () => {
      const media = await library.for('post', '2').add(await png()).toCollection('files')
      await library.performConversions(media.id)
      const fresh = await repo.findById(media.id)
      expect(fresh?.generatedConversions.thumb).toBe(true)
    })

    it('produces a signed URL that fetches the object', async () => {
      const media = await library.for('post', '3').add(await png()).toCollection('files')
      const res = await fetch(await library.urlGenerator.signedUrl(media))
      expect(res.status).toBe(200)
      expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0)
    })

    it('deletes every object it wrote', async () => {
      const media = await library.for('post', '4').add(await png()).toCollection('files')
      const disk = await library.storage.disk(media.disk)
      const key = `${prefix}/${media.id}/${media.fileName}`
      expect(await disk.exists(key)).toBe(true)
      await library.deleteMedia(media.id)
      expect(await disk.exists(key)).toBe(false)
    })

    it.runIf(Boolean(opts.publicBaseUrl))('public URLs come from baseUrl', async () => {
      const media = await library.for('post', '5').add(await png()).toCollection('files')
      const url = await library.urlGenerator.url(media)
      expect(url.startsWith(opts.publicBaseUrl!.replace(/\/+$/, ''))).toBe(true)
    })
  })
}
```

- [ ] **Step 3: Export it**

`packages/core/src/testing/index.ts` becomes:

```ts
export * from './repository-contract.js'
export * from './queue-contract.js'
export * from './storage-contract.js'
```

No export-map change is needed — `./testing` is an existing entry point in both `exports` and `publishConfig.exports`.

- [ ] **Step 4: Write the MinIO suite**

Create `packages/core/test/storage-minio.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runStorageCycleContract } from '../src/testing/storage-contract.js'

const endpoint = process.env.S3_ENDPOINT
if (!endpoint) console.warn('[storage tests] S3_ENDPOINT not set — MinIO cycle contract skipped')

// MinIO needs path-style addressing and accepts ACLs, so this run proves the
// generic s3 wire protocol — NOT R2's ACL suppression or checksum handling.
// Only storage-r2.test.ts can prove those.
describe.skipIf(!endpoint)('minio (requires S3_ENDPOINT)', () => {
  runStorageCycleContract('minio', {
    disk: {
      driver: 's3',
      bucket: process.env.S3_BUCKET ?? 'media-test',
      region: 'us-east-1',
      endpoint: endpoint!,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'minioadmin',
      },
    },
  })
})
```

Gating style matches `packages/bullmq/test/driver.test.ts` — `describe.skipIf` plus a
`console.warn` naming the missing variable. Deliberately **no** placeholder "skipped"
companion test: CLAUDE.md's ungated-companion rule is satisfied by the real offline
coverage in `s3-disk.test.ts` (Tasks 1-2) and `r2-visibility.test.ts` (Task 4). A test
whose only assertion is that an env var is unset asserts nothing.

Adjust the import to what the file actually uses:

```ts
import { describe } from 'vitest'
```

- [ ] **Step 5: Write the R2 suite**

Create `packages/core/test/storage-r2.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { runStorageCycleContract } from '../src/testing/storage-contract.js'

const accountId = process.env.R2_ACCOUNT_ID
const bucket = process.env.R2_BUCKET
const accessKeyId = process.env.R2_ACCESS_KEY_ID
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
const configured = Boolean(accountId && bucket && accessKeyId && secretAccessKey)
if (!configured) console.warn('[storage tests] R2_* not set — R2 cycle contract skipped')

// The authority on R2-specific behavior: ACL suppression (every write would
// otherwise carry x-amz-acl, which R2 rejects), checksum compatibility, and
// r2.dev/custom-domain serving. Dormant until repository secrets are added.
describe.skipIf(!configured)('cloudflare-r2 (requires R2_*)', () => {
  runStorageCycleContract('cloudflare-r2', {
    disk: {
      driver: 'r2',
      accountId: accountId!,
      bucket: bucket!,
      credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
      ...(process.env.R2_BASE_URL ? { baseUrl: process.env.R2_BASE_URL } : {}),
    },
    ...(process.env.R2_BASE_URL ? { publicBaseUrl: process.env.R2_BASE_URL } : {}),
  })
})
```

Same convention as the MinIO suite above, and likewise no placeholder companion.

Adjust the import to what the file actually uses:

```ts
import { describe } from 'vitest'
```

- [ ] **Step 6: Run both locally to confirm they skip cleanly**

```bash
pnpm --filter @node-media-library/core test storage-minio
```

Then:

```bash
pnpm --filter @node-media-library/core test storage-r2
```

Expected: PASS, with the contract suites reported as skipped and the `console.warn` naming the missing env var. Vitest exits 0 on a file whose only suite is skipped.

- [ ] **Step 7: Add MinIO to CI**

In `.github/workflows/ci.yml`, add to the `services:` block of the `test` job, after `rabbitmq`:

```yaml
      minio:
        image: bitnami/minio:latest
        ports: ['9000:9000']
        env:
          MINIO_ROOT_USER: minioadmin
          MINIO_ROOT_PASSWORD: minioadmin
          MINIO_DEFAULT_BUCKETS: media-test
        options: >-
          --health-cmd "curl -f http://localhost:9000/minio/health/live"
          --health-interval 10s --health-timeout 5s --health-retries 10
```

Then extend the `env:` block of the `pnpm -r test` step:

```yaml
        env:
          REDIS_URL: 'redis://localhost:6379'
          AMQP_URL: 'amqp://guest:guest@localhost:5672'
          S3_ENDPOINT: 'http://localhost:9000'
          S3_BUCKET: 'media-test'
          S3_ACCESS_KEY_ID: 'minioadmin'
          S3_SECRET_ACCESS_KEY: 'minioadmin'
          R2_ACCOUNT_ID: '${{ secrets.R2_ACCOUNT_ID }}'
          R2_BUCKET: '${{ secrets.R2_BUCKET }}'
          R2_ACCESS_KEY_ID: '${{ secrets.R2_ACCESS_KEY_ID }}'
          R2_SECRET_ACCESS_KEY: '${{ secrets.R2_SECRET_ACCESS_KEY }}'
          R2_BASE_URL: '${{ secrets.R2_BASE_URL }}'
```

Unset secrets expand to empty strings, so the R2 suite stays dormant until they are added. `bitnami/minio` is used over `minio/minio` because the official image needs a `server /data` command argument, which service containers cannot supply; `MINIO_DEFAULT_BUCKETS` also creates the bucket without a separate `mc` step.

- [ ] **Step 8: Run the full suite, typecheck and format check**

```bash
pnpm --filter @node-media-library/core test
```

Then:

```bash
pnpm -r typecheck
```

Then:

```bash
pnpm format:check
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/testing/storage-contract.ts packages/core/src/testing/index.ts packages/core/test/storage-minio.test.ts packages/core/test/storage-r2.test.ts .github/workflows/ci.yml
git commit -m "test(core): add a shared storage cycle contract, MinIO in CI, gated R2 suite"
```

- [ ] **Step 10: Push and confirm MinIO is actually green in CI**

```bash
git push -u origin feat/cloudflare-r2-support
```

Then:

```bash
gh run watch
```

This is the first execution of the `s3` path anywhere. If it fails on checksums, that is the CRC32 risk landing: set `requestChecksumCalculation: 'when_required'` in `storage-minio.test.ts`, confirm it goes green, and record the finding — it becomes the evidence for whether `normalizeR2` should preset the same value.

---

### Task 7: Documentation and changeset

**Files:**
- Modify: `packages/core/README.md`, `README.md`, `website/src/content/docs/reference/configuration.mdx`, `website/src/content/docs/production/limitations.mdx`
- Create: `.changeset/<generated>.md`

**Interfaces:**
- Consumes: the final shipped behavior of Tasks 1-6. Nothing consumes this task.

- [ ] **Step 1: Locate every claim this work falsifies**

```bash
grep -rn "baseUrl\|s3/gcs\|fs/S3/GCS\|custom UrlGenerator\|ACL" README.md packages/core/README.md website/src/content/docs/reference/configuration.mdx website/src/content/docs/production/limitations.mdx
```

Work from that list. Every hit is either updated or confirmed still true.

- [ ] **Step 2: Update `packages/core/README.md`**

Five edits, all required:

1. **"Storage disks"** (~line 327): "accepts `fs`, `s3`, and `gcs` driver configs" becomes `fs`, `s3`, `r2`, and `gcs`. Add below it:

````markdown
Cloudflare R2:

```ts
storage: {
  default: 'r2',
  disks: {
    r2: {
      driver: 'r2',
      accountId: process.env.R2_ACCOUNT_ID!,
      bucket: 'my-media',
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      // Required only for `.public()` collections: R2 has no object ACLs, so
      // public access comes from an r2.dev subdomain or a custom domain.
      baseUrl: 'https://cdn.example.com',
    },
  },
}
```

The `s3` and `r2` drivers need the AWS SDK, which is an optional peer:

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```
````

2. **Env table**: add `MEDIA_R2_ACCOUNT_ID`, `MEDIA_R2_BUCKET`, `MEDIA_R2_BASE_URL`, `MEDIA_R2_ACCESS_KEY_ID`, `MEDIA_R2_SECRET_ACCESS_KEY`, and state the precedence: R2 → S3 → GCS → fs.

3. **"URL building per driver"** (~line 358): delete the bullet claiming `baseUrl` is unconsumed by `s3`/`gcs`. Replace with: `baseUrl` sets the public URL base on every driver; signed URLs always presign against the real endpoint and ignore it.

4. **"Security model"** (~line 387): the claim that `.public()` writes public ACLs is false on R2. Rewrite to say visibility is ACL-based on S3 and GCS but bucket-level on R2, where `.public()` is a storage-layer no-op; that default keys are `prefix/{uuid}/{fileName}` and therefore unguessable; and that mixing public and private collections on one R2 bucket is unsupported — use two disks.

5. **Roadmap "Known limitations"** (~line 416): delete the `baseUrl`-unconsumed bullet. Add: MinIO covers the `s3` path in CI, but R2-specific behavior is only verified when R2 credentials are configured.

- [ ] **Step 3: Update the root `README.md`**

The backend list (~line 23) becomes `fs/S3/R2/GCS`. Mirror the storage-section and config-table changes from Step 2, and confirm the signed-URL note (~line 408) still reads true.

- [ ] **Step 4: Update the docs site**

- `website/src/content/docs/reference/configuration.mdx`: env table (~line 107) gains the `MEDIA_R2_*` rows; disk table (~line 126) gains the `r2` driver and the new `s3` options; the `urlGenerator` row (~line 135) currently says a custom CDN hostname requires a custom `UrlGenerator` — now false, so point it at `baseUrl`.
- `website/src/content/docs/production/limitations.mdx`: same `baseUrl` retirement as Step 2.

- [ ] **Step 5: Regenerate the API reference**

CI fails on a stale committed API reference.

```bash
pnpm --filter @node-media-library/core docs:api
```

Then:

```bash
git diff --stat -- website/src/content/docs/api
```

Expected: `DiskConfig` picks up the new members and their JSDoc.

- [ ] **Step 6: Write the changeset**

```bash
pnpm changeset
```

Select `@node-media-library/core`, **minor**, and use this summary:

```markdown
Add first-class Cloudflare R2 support via a new `driver: 'r2'` disk config, which derives the S3 API endpoint from your account ID, disables the ACL headers R2 rejects, and builds public URLs from `baseUrl`.

The `s3` driver gains `credentials`, `supportsACL`, `forcePathStyle`, and `requestChecksumCalculation`, making MinIO, Backblaze B2, and DigitalOcean Spaces configurable too. `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are now declared as optional peer dependencies — install them to use `s3` or `r2`.

`baseUrl` is now honored on every driver, not just `fs`. **If you already set `baseUrl` on an `s3` or `gcs` disk it was silently ignored, and public URLs will now be built from it.** That was the documented behavior it replaces, but it does change the URLs those disks emit.

Public collections on an R2 disk with no `baseUrl` now throw when the `MediaLibrary` is constructed, because R2 has no object ACLs and such a URL could never resolve.
```

- [ ] **Step 7: Verify formatting, types, tests and build**

```bash
pnpm format
```

Then:

```bash
pnpm format:check
```

Then:

```bash
pnpm -r typecheck
```

Then:

```bash
pnpm -r test
```

Then:

```bash
pnpm -r build
```

Expected: all PASS. Confirm `pnpm format` touched no `package.json` and not this plan file — both are prettier-ignored.

- [ ] **Step 8: Commit**

```bash
git add README.md packages/core/README.md website/src/content/docs .changeset
git commit -m "docs(core): document the r2 driver and correct the visibility model"
```

- [ ] **Step 9: Open the PR**

```bash
git push
```

Then:

```bash
gh pr create --title "feat(core): first-class Cloudflare R2 support" --body "$(cat <<'EOF'
Makes R2 adoptable by configuration alone, and closes the adjacent gaps that left the `s3` driver uninstallable and untested.

Spec: `docs/superpowers/specs/2026-08-10-cloudflare-r2-support-design.md`

## What was broken

- **Every write sent `x-amz-acl`.** flydrive sets an ACL on every put unless `supportsACL: false`, which core could not forward. R2 has no object ACLs, so `.public()` collections failed on upload.
- **`url()` returned a dead link, silently.** `publicUrlFor` honored `baseUrl` only for `fs`, so R2 public URLs pointed at the authenticated S3 API host, which 401s.
- **The `s3` path was uninstallable as documented.** Core declared neither AWS SDK peer, and no test had ever executed the branch.

## What changed

- `driver: 'r2'` derives the endpoint from `accountId`, forces `supportsACL: false` and `region: 'auto'`, then normalizes into the widened `s3` shape — one code path builds the driver.
- `driver: 's3'` gains `credentials`, `supportsACL`, `forcePathStyle`, `requestChecksumCalculation`, which also makes MinIO/Backblaze/Spaces configurable.
- `baseUrl` is honored on every driver. flydrive's `cdnUrl` is deliberately not exposed — two options meaning "public URL base" is worse than one, and `new URL(key, cdnUrl)` mangles a base with a path.
- Public collections on an R2 disk with no `baseUrl` throw at construction. A single R2 disk serving both public and private collections warns.
- `MEDIA_R2_*` env synthesis, precedence R2 → S3 → GCS → fs.
- A shared `storageCycleContract` runs against MinIO in CI (the first real execution of the `s3` path) and against real R2 when secrets exist.

## Known gap

MinIO accepts ACLs, so it cannot prove R2's `supportsACL` suppression or its checksum handling. The R2 suite stays dormant until `R2_*` repository secrets are added. Documented in the core README rather than implied as covered.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:** §4.1 config surface → Tasks 1-2. §4.2 normalization → Task 2. §4.3 `baseUrl` unification → Task 3. §4.4 fail-fast → Task 4. §4.5 mixed-visibility warning → Task 4. §4.6 testing → Task 6. §4.7 env synthesis → Task 5. §4.8 packaging → Task 1. §5 documentation → Task 7. §6 risks: CRC32 → Task 6 Step 10; `baseUrl` migration → Task 7 changeset; GCS fallthrough → Task 2 Step 5. §7 success criteria → Task 7 Step 7.

**Type consistency:** `S3Credentials` (Task 1) is consumed unchanged by the `r2` variant (Task 2), env synthesis (Task 5), and both gated suites (Task 6). `normalizeR2` returns `Extract<DiskConfig, { driver: 's3' }>`, exactly what the `s3` branch consumes. `checkCollectionVisibility(models, storage)` (Task 4) matches its single call site in `library.ts`. `runStorageCycleContract(name, { disk, publicBaseUrl? })` (Task 6) matches both callers.

**Unverified identifiers, checked at point of use:** Task 4 Step 1 and Task 6 Step 1 each open with a `grep` confirming builder and repository method names (`useDisk`, `useConversionsDisk`, `repo.all`, `repo.findById`, `deleteMedia`, `conversion().width`) against real source before the tests that call them are written. Every other symbol in this plan was read from the codebase during planning.
