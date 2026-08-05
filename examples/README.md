# @node-media-library/examples

The documentation site's code samples, kept executable. Private — never published.

## Why this exists

CLAUDE.md treats a doc that over- or under-states shipped behavior as a defect. That rule is only
enforceable if something runs the docs. So the guides don't contain hand-typed snippets: they import
regions of the files in `src/`, and `test/` executes those same files in CI.

This is not hypothetical. The first pass of README examples shipped a `createMediaLibrary()` config
whose own `firstUrl()` call threw `StorageError`, because the `fs` disk had no `baseUrl`. Running the
sample is what surfaced it.

## How a sample reaches a page

Mark a region in `src/`:

```ts
// #region config
export function createLibrary(storageRoot = './storage/media') {
  /* … */
}
// #endregion config
```

Embed it in `website/src/content/docs/…`:

```mdx
import { Code } from '@astrojs/starlight/components'
import source from '@examples/first-upload.ts?raw'
import { snippet } from '../../../lib/snippet'

<Code code={snippet(source, 'config')} lang="ts" title="media.ts" />
```

Rename or delete that region and `astro build` **fails**, listing the regions that do exist. A silent
empty code block would defeat the point.

## Conventions

**Write for the reader first.** These files are published as documentation, so they are ordinary,
copy-pasteable modules — not test fixtures with assertions inlined. Keep regions short enough to read
on a page.

**Take a defaulted `storageRoot`.** `createLibrary(storageRoot = './storage/media')` means the
documented call is a bare `createLibrary()` while tests pass a `mkdtemp()` directory. No `chdir`, no
environment variables leaking into snippets.

**Assert the caveats, not just the happy path.** `test/private-files.test.ts` asserts that
`signedUrl()` degrades to an unsigned URL on the `fs` driver — the exact behavior the page's "sharp
edge" callout describes. A limitation nobody tests is a limitation that can quietly stop being true,
in either direction.

**Only claim what runs.** The `.nml-verified` line on a page says its samples execute in CI. Pages
whose code can't run — the framework handlers in the uploads guide need Express and Next.js — say so
instead of claiming coverage they don't have.

## Commands

```bash
pnpm --filter @node-media-library/examples test       # run every sample
pnpm --filter @node-media-library/examples typecheck
```

Both also run as part of the workspace-wide `pnpm -r test` / `pnpm -r typecheck`.
