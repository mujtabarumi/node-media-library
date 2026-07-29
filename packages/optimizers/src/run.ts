import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Runs `binaryPath args` via execFile (no shell), resolving on success. */
export async function runBinary(binaryPath: string, args: string[]): Promise<void> {
  await execFileAsync(binaryPath, args)
}

/** True when `binaryPath probeArgs` runs at all; false on ENOENT (binary not installed). */
export async function binaryAvailable(binaryPath: string, probeArgs: string[]): Promise<boolean> {
  try {
    await execFileAsync(binaryPath, probeArgs)
    return true
  } catch (err) {
    // ENOENT → not installed; a non-zero exit from an existing binary still proves presence
    return (err as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}
