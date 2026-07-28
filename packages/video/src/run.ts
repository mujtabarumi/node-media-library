import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function ffmpegAvailable(binaryPath = 'ffmpeg'): Promise<boolean> {
  try {
    await execFileAsync(binaryPath, ['-version'])
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

/**
 * Writes `video` to a temp file, runs `binaryPath args(videoPath, outPath)`,
 * returns `outPath`'s bytes. Temp dir always removed.
 */
export async function extractViaTempFiles(
  binaryPath: string,
  video: Buffer,
  args: (videoPath: string, outPath: string) => string[],
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'nml-video-'))
  try {
    const videoPath = join(dir, 'in.bin')
    const outPath = join(dir, 'out.png')
    await writeFile(videoPath, video)
    await execFileAsync(binaryPath, args(videoPath, outPath))
    return await readFile(outPath)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
