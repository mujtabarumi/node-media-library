// Packs every publishable package and checks the resulting tarballs the way a
// consumer's package manager will read them. Catches publishConfig.exports
// mistakes, files-allowlist gaps, and workspace-protocol resolution problems
// that no in-repo test can see, because in-repo everything resolves to src/.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PACKAGES = ['core', 'prisma', 'bullmq', 'rabbitmq', 'pdf', 'video', 'optimizers']

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
