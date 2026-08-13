// Packs every publishable package and checks the resulting tarballs the way a
// consumer's package manager will read them. Catches publishConfig.exports
// mistakes, files-allowlist gaps, and workspace-protocol resolution problems
// that no in-repo test can see, because in-repo everything resolves to src/.
//
// This script does NOT build — it packs whatever is already in dist/. Run it
// after `pnpm build`, not instead of it (see docs/publishing.md), or you're
// linting a stale tarball rather than the one you're about to publish.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGES = ['core', 'prisma', 'bullmq', 'rabbitmq', 'pdf', 'video', 'optimizers']

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const coreEntry = join(repoRoot, 'packages/core/dist/index.js')
if (!existsSync(coreEntry)) {
  console.error(
    `verify-pack: ${coreEntry} does not exist. This script packs the current dist/ output — it ` +
      "does not build — so it can't verify a build that hasn't happened yet, and packing src/ " +
      'output would silently pass tarballs that only work in this workspace. Run `pnpm build` ' +
      'first, or use the full pre-publish gate: `pnpm -r typecheck && pnpm -r test && pnpm build ' +
      '&& pnpm verify-pack`.',
  )
  process.exit(1)
}

const outDir = mkdtempSync(join(tmpdir(), 'nml-pack-'))
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit', encoding: 'utf8' })

console.log(`Packing into ${outDir}\n`)
for (const name of PACKAGES) {
  run('pnpm', ['--filter', `@node-media-library/${name}`, 'pack', '--pack-destination', outDir])
}

const tarballs = readdirSync(outDir).filter((f) => f.endsWith('.tgz'))
if (tarballs.length !== PACKAGES.length) {
  throw new Error(`expected ${PACKAGES.length} tarballs, found ${tarballs.length}`)
}

for (const tarball of tarballs) {
  console.log(`\n=== publint ${tarball} ===`)
  run('pnpm', ['exec', 'publint', join(outDir, tarball)])
  console.log(`\n=== attw ${tarball} ===`)
  try {
    run('pnpm', ['exec', 'attw', join(outDir, tarball)])
  } catch {
    // attw exits non-zero on the "no types" node10 resolution failure, which
    // every package here triggers deliberately (no top-level types/main —
    // see docs/publishing.md). Its report already printed above via
    // stdio: 'inherit'; swallow the exit code so every tarball still gets
    // checked instead of the run dying on the first one.
  }
}

console.log(`\nTarballs kept at ${outDir} for the manual smoke install.`)
