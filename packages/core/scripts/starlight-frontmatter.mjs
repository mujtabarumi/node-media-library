/**
 * Adds Starlight frontmatter to TypeDoc's markdown output.
 *
 * `typedoc-plugin-markdown` emits no frontmatter, and Starlight's content
 * collection requires a `title` — without this, `astro build` fails on the
 * first generated file. `typedoc-plugin-frontmatter` cannot help: it only
 * injects static values shared by every page, and each page needs its own
 * title.
 *
 * Runs inside packages/core, where the library's dependencies are installed,
 * so Cloudflare never has to build the workspace to publish the site.
 */
import { readdir, readFile, writeFile, rename, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, dirname, basename, resolve, relative } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../../website/src/content/docs/api')

/** TypeDoc prefixes headings with the reflection kind; Starlight wants the bare name. */
const KIND_PREFIX = /^(Class|Interface|Function|Type Alias|Variable|Enumeration|Namespace): /

function titleFor(content, file) {
  const heading = content.match(/^# (.+)$/m)
  if (!heading) return basename(file, '.md')
  return heading[1].replace(KIND_PREFIX, '').replace(/\(\)$/, '').trim()
}

/** Single-quoted YAML; the only character needing escaping is the quote itself. */
const yaml = (value) => `'${String(value).replace(/'/g, "''")}'`

/**
 * Rewrites TypeDoc's `./Foo.md` cross-links to absolute Starlight routes.
 *
 * Two reasons they cannot be left alone. Astro does not strip `.md` from
 * markdown links, so they 404. And Starlight serves directory-style URLs
 * (`/api/classes/MediaLibrary/`), which adds a path segment — so a relative
 * `../interfaces/Foo` resolves one level too deep. Absolute routes sidestep
 * both.
 */
const MD_LINK = /\]\(([^)\s]+\.md)(#[^)]*)?\)/g

function rewriteLinks(content, file) {
  return content.replace(MD_LINK, (_match, target, anchor = '') => {
    const slug = relative(OUT, resolve(dirname(file), target))
      .replace(/\\/g, '/')
      .replace(/\.md$/, '')
    // README was renamed to index below; both denote the section root.
    const route = slug === 'index' || slug === 'README' ? '/api/' : `/api/${slug}/`
    return `](${route}${anchor})`
  })
}

/**
 * Drops `Defined in:` lines that point into `node_modules`.
 *
 * TypeDoc renders a source line for every member, including the `Error`
 * members the error classes inherit (`message`, `stack`, `cause`, and the
 * `captureStackTrace`/`prepareStackTrace`/`stackTraceLimit` statics). Those
 * resolve into the pnpm store, so the emitted path carries an exact version:
 * `node_modules/.pnpm/@types+node@22.20.1/...`. A patch bump of `@types/node`
 * or `typescript` rewrites all 56 of them, and CI's regenerate-and-diff check
 * fails until the reference is regenerated and committed — churn with no API
 * surface change behind it.
 *
 * Unlike first-party sources these are plain text, not links: TypeDoc has no
 * repository to map them onto, so they name a path that exists only on the
 * machine that ran the build. Nothing is lost by removing them, and the member
 * itself — with its `Inherited from` cross-link — stays.
 *
 * `excludeExternals` is the tempting native alternative, but it deletes those
 * inherited members outright AND shortens first-party link text to a bare
 * `errors.ts:35` (excluding node_modules moves TypeDoc's computed base path).
 * This keeps both intact.
 */
const EXTERNAL_SOURCE = /^Defined in:.*node\\?_modules.*\n?\n?/gm

const stripExternalSources = (content) => content.replace(EXTERNAL_SOURCE, '')

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (entry.name.endsWith('.md')) yield path
  }
}

try {
  await stat(OUT)
} catch {
  console.error(`[starlight-frontmatter] ${OUT} does not exist — run typedoc first.`)
  process.exit(1)
}

// The generated index lands at README.md, which would route to /api/readme.
// Renaming it makes the section's own URL /api/.
const readme = join(OUT, 'README.md')
try {
  await stat(readme)
  await rename(readme, join(OUT, 'index.md'))
} catch {
  // `readme: none` may already have suppressed it.
}

let count = 0
for await (const file of walk(OUT)) {
  const content = await readFile(file, 'utf8')
  if (content.startsWith('---\n')) continue // already processed

  const isIndex = file === join(OUT, 'index.md')
  const title = isIndex ? 'API reference' : titleFor(content, file)

  const frontmatter = [
    '---',
    `title: ${yaml(title)}`,
    // These pages are generated; sending readers to GitHub to edit them
    // would invite changes that the next regeneration silently discards.
    'editUrl: false',
    ...(isIndex
      ? [
          "description: 'Generated reference for every public export of @node-media-library/core.'",
          'banner:',
          "  content: 'Generated from source by TypeDoc. Prefer the guides for how to use the library — this is the exhaustive surface.'",
        ]
      : []),
    '---',
    '',
  ].join('\n')

  await writeFile(file, frontmatter + stripExternalSources(rewriteLinks(content, file)))
  count++
}

console.log(`[starlight-frontmatter] processed ${count} pages`)
