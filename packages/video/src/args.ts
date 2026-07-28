/** Pure arg builder for `ffmpeg`: seek (fast, pre-input), grab 1 frame as png. */
export function buildFfmpegFrameArgs(atSecond: number, videoPath: string, outPath: string): string[] {
  return ['-ss', String(atSecond), '-i', videoPath, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', '-y', outPath]
}
