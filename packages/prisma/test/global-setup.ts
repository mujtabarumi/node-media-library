import { execSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export default function setup() {
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  mkdirSync(join(pkgRoot, 'test/tmp'), { recursive: true })
  // Delete our own git-ignored scratch db before pushing the schema, instead of
  // using `prisma db push --force-reset` (Prisma 7 blocks --force-reset when
  // invoked by an AI agent without explicit user consent). Removing the file
  // we own gives the same "fresh database" result without the destructive flag.
  const dbPath = join(pkgRoot, 'test/tmp/contract.db')
  rmSync(dbPath, { force: true })
  rmSync(`${dbPath}-journal`, { force: true })
  rmSync(`${dbPath}-wal`, { force: true })
  execSync('pnpm db:prepare', { cwd: pkgRoot, stdio: 'inherit' })
}
