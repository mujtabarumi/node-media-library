# Documentation site hosting

**Date:** 2026-08-05
**Status:** Decided
**Scope:** Where `website/` is deployed, and what that constrains.

## Decision

Deploy the documentation site to **Cloudflare Pages**. A future interactive playground is explicitly
out of scope for this host and belongs on a separate container platform.

## Context

`website/` is an Astro + Starlight site producing static output — no adapter, no server runtime. It is
deliberately outside the pnpm workspace because Astro requires Node ≥ 22.12 while the library supports
≥ 20 and CI tests both.

Anticipated expansion, in the maintainer's own words: more docs and eventual versioning, some
server-side pieces, a live playground, and a custom domain with analytics.

Crucially, the project's commercial status is **undecided** — personal today, possibly
company-affiliated later.

## Options considered

### Cloudflare Pages (chosen)

- Free plan permits commercial use.
- Bandwidth is not metered.
- 500 builds/month, 1 concurrent build, 100 custom domains, 20,000 files per deployment.
- SSR available later via `@astrojs/cloudflare`, running on Workers.

### Vercel Hobby (rejected)

- Better Astro DX; `@astrojs/vercel` is a smoother adapter, previews are slicker.
- **Hobby forbids commercial use.** Vercel's definition includes "a paid employee or consultant
  writing the code" — not merely sites that take payment.
- 100 GB/month bandwidth cap.
- Escaping either constraint means Pro at $20/user/month.

### GitHub Pages (rejected)

Free and unrestricted, but no preview deployments and no SSR path. Weaker on both axes that matter
later.

## Rationale

The deciding factor is the undecided commercial status. Vercel's terms would be violated the moment
this becomes work-time at a company — not a hypothetical for a project whose author's other work is
commercial. Choosing the platform that never needs revisiting is worth more than Vercel's better
tooling.

Unmetered bandwidth is the secondary reason. Documentation traffic is spiky; a front-page posting can
exhaust 100 GB in the exact week the site must stay up.

The DX gap is real and accepted. If the project were certainly-forever-personal, Vercel would be the
better daily experience.

## Consequences

### Install must work without a flag

Cloudflare runs a bare `pnpm install`. Run from `website/`, that walks up to the repo-root
`pnpm-workspace.yaml`, installs the monorepo, and leaves `website/node_modules` empty — the build then
fails with no `astro` binary.

Fixed by `website/pnpm-workspace.yaml` (`packages: []`), which declares the directory its own workspace
root so pnpm stops there. **Verified from a cold `node_modules`.**

Rejected alternative: `website/.npmrc` with `ignore-workspace=true`. Tested and does **not** work —
pnpm 10 honours `--ignore-workspace` only as a CLI flag. A config-shaped fix that silently does nothing
is worse than none, so it was removed.

`.github/workflows/docs.yml` now installs without the flag on purpose: CI exercises the same command
Cloudflare runs.

### Node version

`website/.node-version` pins 22.16.0. The repo root's `.nvmrc` says `20` — correct for the library,
below Astro's floor. Cloudflare honours `.nvmrc`/`.node-version` in the configured root directory, and
its default is already 22.16.0, so this is defence in depth rather than strictly required.

### Build settings

Framework preset Astro; build command `pnpm build`; output directory `dist`; root directory `website`.
No environment variables required.

### `site` must match the deployed hostname

`astro.config.mjs` sets `site`, which feeds the sitemap and canonical URLs. It is currently
`https://node-media-library.pages.dev`, correct only if the Pages project is named
`node-media-library`. Attaching a custom domain means updating it.

### The build reads files outside `website/`

Three guide pages import `@examples/*.ts?raw` from `../examples/src/`, which is what makes the
executable-samples guarantee work. Cloudflare clones the whole repository, so this resolves — but it is
the first thing to check if a deploy fails with an unresolved import. (Vercel would have required
explicitly enabling "Include source files outside of the Root Directory".)

## Deferred: the playground

An interactive playground cannot run on Cloudflare Workers. `sharp` is a native addon and the pdf/video
packages spawn `pdftoppm` and `ffmpeg`; V8 isolates provide neither native addons nor `child_process`,
regardless of `nodejs_compat`. Vercel's Node runtime could host `sharp`, but bundling ffmpeg against a
250 MB limit is unpleasant.

The correct shape is a separate deployment on a container host (Fly.io, Railway, Render) behind its own
subdomain. A docs site wants static, cached, globally replicated output; a service accepting untrusted
uploads and spawning ffmpeg wants a real process with CPU/memory limits and isolation. Coupling them
forces the wrong host on one of them.

**This is deliberately not a reason to prefer Vercel** — neither platform hosts the playground, so it
should not influence where the docs live.

## Future expansion

- **Versioned docs** — static; `starlight-versions`. No hosting change.
- **Server-side pieces** (OG images, forms, logic-driven redirects) — add `@astrojs/cloudflare` and
  Pages Functions. Free plan includes Workers requests.
- **Custom domain + analytics** — Cloudflare Web Analytics is free and cookie-free. 100 custom domains
  on the free plan.
- **Limits to watch** — 500 builds/month is the first likely ceiling. `docs.yml`'s path filter and a
  Cloudflare build watch path both help by skipping library-only commits.

## Verify on first deploy

1. Build succeeds — confirms the bare install resolves and `../examples` is reachable.
2. `sitemap-index.xml` contains the real hostname.
3. Pagefind search returns results (it is built at deploy time, not committed).
4. Dark/light theme toggle persists.
