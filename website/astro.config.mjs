// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

const REPO = 'https://github.com/mujtabarumi/node-media-library'

export default defineConfig({
  site: 'https://node-media-library.pages.dev',
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
          label: 'Guides',
          items: [
            { label: 'Handling uploads', slug: 'guides/uploads' },
            { label: 'Avatars & single-file collections', slug: 'guides/avatars' },
            { label: 'Private files & downloads', slug: 'guides/private-files' },
          ],
        },
        {
          label: 'Reference',
          items: [{ label: 'Errors', slug: 'reference/errors' }],
        },
        {
          label: 'Production',
          items: [
            { label: 'Security model', slug: 'production/security' },
            { label: 'Known limitations', slug: 'production/limitations' },
          ],
        },
      ],
    }),
  ],
})
