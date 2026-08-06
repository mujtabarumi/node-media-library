# node-media-library docs

The documentation site, built with [Astro](https://astro.build) and
[Starlight](https://starlight.astro.build).

## Not a workspace package

This directory is deliberately **outside** the pnpm workspace (`pnpm-workspace.yaml` lists only
`packages/*`) and keeps its own `pnpm-lock.yaml`. Astro requires Node ≥ 22.12 while the library
supports Node ≥ 20 and CI tests against both — adding the site to the workspace would break the Node
20 leg of `pnpm -r build`, and would make every library install pull down the site's dependency tree.

`pnpm-workspace.yaml` in this directory is what makes that work. It declares `website/` its own
workspace root with no members, so pnpm stops here instead of walking up to the repo root. Without it
a bare `pnpm install` installs the _monorepo_ and leaves `website/node_modules` empty — the build
then fails with no `astro` binary. `--ignore-workspace` fixes that too, but only if whoever runs the
install remembers the flag, and Cloudflare Pages runs a bare `pnpm install`.

Consequences worth knowing:

- The root `pnpm -r test` / `typecheck` / `build` commands do not touch the site.
- The site is built and checked by its own workflow, `.github/workflows/docs.yml`, on Node 22.
- `.node-version` pins Node 22 here. The repo root's `.nvmrc` says `20` — correct for the library,
  below Astro's floor for this site.

## Local development

```bash
pnpm install
pnpm dev      # http://localhost:4321
pnpm build    # production build into dist/
pnpm preview  # serve the built site
pnpm check    # astro check — type and content-collection errors
```

## Layout

```
src/
  content/docs/     one Markdown/MDX file per page; the URL mirrors the path
  components/       SharpEdge.astro, Requires.astro
  styles/theme.css  the darkroom palette and this site's own component styles
astro.config.mjs    Starlight config, including the sidebar
```

## Conventions

**The nav is task-shaped, not package-shaped.** Adapters are documented inside the guide that
motivates them — BullMQ under background conversions, `pdf`/`video` under thumbnails — with a single
Packages reference page for their option tables. A nav split by package means writing every topic
twice.

**`<SharpEdge>` is reserved for documented limitations.** Every instance must correspond to an entry
on the Known limitations page and link to its anchor. Use Starlight's ordinary `<Aside>` for
everything else — the value of the marker is that readers learn it means one specific thing.

**`<Requires>` states external prerequisites**, e.g. `<Requires items={['ffmpeg']} />`. Nothing in
this library auto-registers, so pages should say up front what a reader needs installed and wired in.

**Docs must match shipped behavior.** A page that over- or under-states what the code does is treated
as a defect, not a nitpick — see the root `CLAUDE.md`. The `.nml-verified` line on guide pages claims
their samples run in CI; don't add it to a page whose code isn't covered yet.

## Deployment

Static output in `dist/` — no adapter, no server runtime. Hosted on **Cloudflare Workers** as an
assets-only Worker, built from git by Workers Builds.

Connect the GitHub repo and set:

| Setting        | Value                 |
| -------------- | --------------------- |
| Project name   | `node-media-library`  |
| Build command  | `pnpm run build`      |
| Deploy command | `npx wrangler deploy` |
| Path           | `website`             |

**`Path` must be `website`.** At the repository root, `pnpm run build` runs the _library_ build
(`pnpm -r build`), not the site.

`wrangler.jsonc` in this directory does the rest. It declares an assets-only Worker — no `main`
script — pointing at `./dist`, so Cloudflare uploads the built files and serves them. Node comes from
`.node-version`, and the dependency install resolves correctly because of `pnpm-workspace.yaml` above.

`wrangler` is a devDependency so the deploy uses a pinned version rather than whatever `npx` resolves
at build time.

Tick **"Builds for non-production branches"** if you want a preview deployment per pull request.

Cloudflare Pages was chosen over Vercel for two reasons. Vercel's Hobby plan forbids commercial use —
their definition covers "a paid employee or consultant writing the code" — so any future company
involvement would force the $20/user/month Pro plan; Cloudflare's free plan permits commercial use.
And Cloudflare does not meter bandwidth, which matters for a docs site whose traffic is spiky. Free
plan limits that could eventually bind: 500 builds/month, one concurrent build, 20,000 files per
deployment. See `docs/superpowers/specs/2026-08-05-docs-site-hosting-design.md`.

**Keep `site` in `astro.config.mjs` correct.** It feeds the sitemap and canonical URLs, so it must
match the deployed hostname. It currently reads `https://node-media-library.pages.dev`, which is
wrong for a Worker — those are served from `https://<name>.<account-subdomain>.workers.dev`, and the
subdomain isn't known until the project exists. Update it after the first deploy, or straight to a
custom domain. Only the sitemap and canonical tags are affected, not routing.

### A playground does not belong here

Running the library live (upload a file, see conversions) cannot work on Cloudflare Workers: `sharp`
is a native addon and the pdf/video packages spawn `pdftoppm`/`ffmpeg`, neither of which exists in a
V8 isolate. That is a container workload — Fly.io, Railway, Render — deployed separately behind its
own subdomain, not a reason to change where the docs are hosted.
