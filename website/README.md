# node-media-library docs

The documentation site, built with [Astro](https://astro.build) and
[Starlight](https://starlight.astro.build).

## Not a workspace package

This directory is deliberately **outside** the pnpm workspace (`pnpm-workspace.yaml` lists only
`packages/*`) and keeps its own `pnpm-lock.yaml`. Astro requires Node ≥ 22.12 while the library
supports Node ≥ 20 and CI tests against both — adding the site to the workspace would break the Node
20 leg of `pnpm -r build`, and would make every library install pull down the site's dependency tree.

Consequences worth knowing:

- Install from inside this directory: `pnpm install --ignore-workspace`.
- The root `pnpm -r test` / `typecheck` / `build` commands do not touch the site.
- The site is built and checked by its own workflow, `.github/workflows/docs.yml`, on Node 22.

## Local development

```bash
pnpm install --ignore-workspace
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

Built as a static site into `dist/`. Cloudflare Pages: build command `pnpm build`, output directory
`dist`, root directory `website`, and `NODE_VERSION` set to `22`.
