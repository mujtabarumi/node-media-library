import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** True when `binaryPath -v` runs at all (pdftoppm prints its version to stderr). */
export async function pdftoppmAvailable(binaryPath = 'pdftoppm'): Promise<boolean> {
  try {
    await execFileAsync(binaryPath, ['-v'])
    return true
  } catch (err) {
    // ENOENT → not installed; a non-zero exit from an existing binary still proves presence
    return (err as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

/**
 * Writes `pdf` to a temp file, runs `binaryPath args(pdfPath, outPrefix)`,
 * returns `${outPrefix}.png`'s bytes. Temp dir always removed.
 */
export async function renderViaTempFiles(
  binaryPath: string,
  pdf: Buffer,
  args: (pdfPath: string, outPrefix: string) => string[],
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'nml-pdf-'))
  try {
    const pdfPath = join(dir, 'in.pdf')
    const outPrefix = join(dir, 'out')
    await writeFile(pdfPath, pdf)
    await execFileAsync(binaryPath, args(pdfPath, outPrefix))
    return await readFile(`${outPrefix}.png`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
