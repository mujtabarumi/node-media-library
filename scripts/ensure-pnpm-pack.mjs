#!/usr/bin/env node
// Guards against `npm publish`/`npm pack` on these packages.
//
// Why: each package's `publishConfig.exports` swaps `exports` to point at
// `dist/*` for consumers, while the package's own top-level `exports` (used
// during local development in this workspace) points at `src/*`. pnpm and
// yarn both understand `publishConfig.exports` and apply the swap when
// packing/publishing. npm does NOT — as of this writing, npm ignores
// `publishConfig.exports` entirely and packs/publishes using the top-level
// `exports` as-is. Since `files` excludes `src/`, an npm-driven publish
// would ship a tarball whose `package.json#exports` points at `src/index.ts`
// (not shipped) instead of `dist/index.js` (built, not yet present at pack
// time unless a build just ran) — broken for consumers either way.
//
// How the check works: `npm_config_user_agent` is set by the package
// manager that invoked this script (via `prepack`) and is inherited by
// child processes. Verified empirically (see the fix-wave report this
// script shipped with) for pnpm 10.25.0 / npm 10.8.2:
//   - `npm pack` / `npm publish`            -> "npm/10.8.2 node/... ..."
//   - `pnpm pack` / `pnpm publish`          -> "pnpm/10.25.0 npm/? node/... ..."
//   - `pnpm exec npm pack` (npm run FROM pnpm) -> "pnpm/10.25.0 npm/? node/... ..."
//     (pnpm sets the variable before invoking the nested npm; npm does not
//     overwrite it) — so this also correctly allows a pnpm-orchestrated
//     invocation that happens to shell out to npm internally.
// A user agent that does not start with "pnpm/" is treated as bare npm (or
// yarn/unknown) and rejected — yarn is not part of this workspace's publish
// flow (see root README), so "pnpm/" is deliberately the only allowed
// prefix rather than also accepting "yarn/".
const userAgent = process.env.npm_config_user_agent ?? ''

if (!userAgent.startsWith('pnpm/')) {
  console.error(
    '[node-media-library] This package must be packed/published with pnpm ' +
      '("pnpm publish" or "pnpm pack"), not npm — npm ignores ' +
      'publishConfig.exports, and the resulting tarball would point at ' +
      '"src/" instead of the built "dist/" output.',
  )
  console.error(`[node-media-library] Detected npm_config_user_agent: ${JSON.stringify(userAgent)}`)
  process.exit(1)
}
