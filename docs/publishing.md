# Publishing

## Before you publish

```bash
pnpm -r typecheck && pnpm -r test && pnpm build && pnpm verify-pack
```

Then do the smoke install below.

### Smoke install

This proves the packed tarballs actually resolve and load in a real install — not just that
`publint`/`attw` are satisfied. The sequence below was run against the packed tarballs at HEAD and
passed.

1. Create a scratch directory **outside this workspace** (a `pnpm-workspace.yaml` anywhere in an
   ancestor directory would hijack the install):

   ```bash
   mkdir -p /tmp/nml-smoke && cd /tmp/nml-smoke
   npm init -y
   npm pkg set type=module
   ```

2. Install the packed core and prisma tarballs (paths from `pnpm verify-pack`'s output, or your own
   `pnpm --filter <pkg> pack --pack-destination`) plus `sharp`:

   ```bash
   npm install /path/to/node-media-library-core-1.0.0.tgz /path/to/node-media-library-prisma-1.0.0.tgz sharp
   ```

3. Write `smoke.mjs`:

   ```js
   import { createMediaLibrary, matchesMediaFilter, VERSION } from '@node-media-library/core'
   import { prismaAdapter } from '@node-media-library/prisma'

   console.log('VERSION:', VERSION)
   console.log('createMediaLibrary:', typeof createMediaLibrary)
   console.log('matchesMediaFilter:', typeof matchesMediaFilter)
   console.log('prismaAdapter:', typeof prismaAdapter)
   ```

4. Run it and check the two things that matter:

   ```bash
   node smoke.mjs
   find node_modules -type d -name core -path '*node-media-library*'
   grep '"@node-media-library/core"' node_modules/@node-media-library/prisma/package.json
   ```

   - `smoke.mjs` must print `VERSION: 1.0.0`.
   - `find` must return **exactly one** path, and the `grep` line must read
     `"@node-media-library/core": "^1.0.0"`. That pair is what proves the `workspace:^` protocol
     resolved to a caret range in the published tarball rather than an exact pin that would force npm
     to install two separate copies of core.

## Prerequisites

- The `@node-media-library` npm scope must exist and be owned by the publishing account. Scoped
  publishes fail hard otherwise. (`.changeset/config.json` already sets `"access": "public"`.)
- If the account requires 2FA on publish, `changeset publish` prompts for an OTP once and reuses the
  cached token across the remaining packages, re-prompting only if the token expires or a publish
  returns `EOTP`. Use an automation token instead to avoid the prompt entirely.

## Publishing

```bash
pnpm release
```

**pnpm only.** Each package's `prepack` (`scripts/ensure-pnpm-pack.mjs`) deliberately fails under
bare `npm publish`, because npm ignores `publishConfig.exports` and would ship a tarball whose entry
points reference unbuilt `src/`.

## Known, accepted limitations

- **No CJS entry points.** No package declares a top-level `types` or `main`, so consumers on
  `moduleResolution: node10` cannot resolve these packages. This is deliberate — the project is
  ESM-only. `attw` reports it on every run; that is expected output, not a regression.
- **1.0.0 ships without npm provenance.** It is a manual publish; there is no publish workflow in
  `.github/workflows/`. CI-based publishing with `NPM_CONFIG_PROVENANCE=true` and
  `permissions: id-token: write` is deferred to 1.0.1+.

## If a publish fails partway

`changeset publish` is **not transactional**. A failure partway leaves the scope partially published,
with adapters depending on a core version that may not be on the registry.

Re-run `pnpm release` — it skips versions already on the registry. Do **not** unpublish. If 1.0.0
ships with a defect, respond with `npm deprecate` plus a 1.0.1.
