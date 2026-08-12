# Publishing

## Before you publish

```bash
pnpm -r typecheck && pnpm -r test && pnpm build && pnpm verify-pack
```

Then do the smoke install described in the consumer-readiness plan, Task 11 Step 5.

## Prerequisites

- The `@node-media-library` npm scope must exist and be owned by the publishing account. Scoped
  publishes fail hard otherwise. (`.changeset/config.json` already sets `"access": "public"`.)
- If the account requires 2FA on publish, `changeset publish` prompts once per package — seven
  times. Use an automation token instead.

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
