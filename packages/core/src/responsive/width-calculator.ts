export interface WidthCalculator {
  calculateWidths(fileSizeBytes: number, width: number, height: number): number[]
}

const MIN_PREDICTED_SIZE = 10 * 1024
const MIN_WIDTH = 20

/**
 * Port of Spatie's FileSizeOptimizedWidthCalculator: each successive variant
 * targets ~70% of the previous predicted file size. Since file size scales
 * with pixel area at constant "pixel price" (bytes per pixel), width shrinks
 * by sqrt(0.7) per step. Stops once the predicted size drops below 10KB or
 * the width below 20px.
 */
export class FileSizeOptimizedWidthCalculator implements WidthCalculator {
  calculateWidths(fileSizeBytes: number, width: number, height: number): number[] {
    const targetWidths: number[] = [Math.floor(width)]
    const ratio = height / width
    const area = height * width
    const pixelPrice = fileSizeBytes / area

    let predictedFileSize = fileSizeBytes
    for (;;) {
      predictedFileSize *= 0.7
      const newWidth = Math.floor(Math.sqrt(predictedFileSize / pixelPrice / ratio))
      if (predictedFileSize < MIN_PREDICTED_SIZE || newWidth < MIN_WIDTH) {
        return targetWidths
      }
      targetWidths.push(newWidth)
    }
  }
}
