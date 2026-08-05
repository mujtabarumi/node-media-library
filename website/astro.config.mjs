// @ts-check
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

const REPO = 'https://github.com/mujtabarumi/node-media-library'

// Guide code is imported as raw text from `examples/src/*.ts` — the same files
// `pnpm --filter @node-media-library/examples test` executes in CI. Those live
// above this project's root (the site is intentionally outside the pnpm
// workspace), so Vite needs both the alias and an explicit fs.allow entry.
const examplesDir = fileURLToPath(new URL('../examples/src', import.meta.url))
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  site: 'https://node-media-library.pages.dev',
  vite: {
    resolve: { alias: { '@examples': examplesDir } },
    server: { fs: { allow: [repoRoot] } },
  },
  integrations: [
    starlight({
      title: 'node-media-library',
      tagline: 'Media handling that cleans up after itself.',
      description:
        'Attach files to any model, derive conversions and responsive variants, and serve them — with pluggable storage, repository, and queue.',
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      editLink: { baseUrl: `${REPO}/edit/main/website/` },
      customCss: ['./src/styles/theme.css'],
      expressiveCode: {
        themes: ['github-dark', 'github-light'],
        styleOverrides: { borderRadius: '0.4rem' },
      },
      // Nav is task-shaped, not package-shaped: each adapter is documented inside
      // the guide that motivates it (BullMQ under background conversions, pdf and
      // video under thumbnails), with a single Packages reference page for the
      // option tables. Splitting the nav by package means writing each topic twice.
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { label: 'Install & requirements', slug: 'start/install' },
            { label: 'Your first upload', slug: 'start/first-upload' },
            { label: 'Core concepts', slug: 'start/concepts' },
          ],
        },
        {
          // Ordered by when a reader hits them, not by topic size. Framework
          // wiring is realistically the second thing everyone does, so it leads.
          label: 'Guides',
          items: [
            { label: 'Handling uploads', slug: 'guides/uploads' },
            { label: 'Avatars & single-file collections', slug: 'guides/avatars' },
            { label: 'Galleries & responsive images', slug: 'guides/galleries' },
            { label: 'Private files & downloads', slug: 'guides/private-files' },
            { label: 'Background conversions', slug: 'guides/background-conversions' },
            { label: 'PDF & video thumbnails', slug: 'guides/pdf-video' },
            { label: 'Importing from a URL', slug: 'guides/url-import' },
            { label: 'Metadata, copy & move', slug: 'guides/metadata' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Errors', slug: 'reference/errors' },
            { label: 'CLI', slug: 'reference/cli' },
            { label: 'Packages', slug: 'reference/packages' },
          ],
        },
        {
          label: 'Production',
          items: [
            { label: 'Persistence with Prisma', slug: 'production/prisma' },
            { label: 'Security model', slug: 'production/security' },
            { label: 'Known limitations', slug: 'production/limitations' },
          ],
        },
        // Last on purpose: a landing page for a specific inbound audience,
        // not a step in the main learning path.
        { label: 'Coming from Laravel MediaLibrary', slug: 'coming-from-laravel' },
      ],
    }),
  ],
})
