export interface RenderedVariant {
  buffer: Buffer
  width: number
  height: number
}

export async function renderVariant(
  input: Buffer,
  width: number,
  format: 'jpeg' | 'png' | 'webp' | 'avif' | null,
  quality: number | null,
): Promise<RenderedVariant> {
  const sharp = (await import('sharp')).default
  let pipeline = sharp(input).rotate().resize({ width })
  if (format) {
    pipeline = pipeline.toFormat(format, { quality: quality ?? undefined })
  }
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  return { buffer: data, width: info.width, height: info.height }
}

/**
 * LQIP: a 32px blurred jpeg wrapped in an SVG at the source's intrinsic
 * dimensions (so the placeholder reserves the right layout box), returned as
 * a base64 SVG data URI. Port of Spatie's approach.
 */
export async function tinyPlaceholder(input: Buffer): Promise<string> {
  const sharp = (await import('sharp')).default
  const image = sharp(input).rotate()
  const meta = await image.metadata()
  const width = meta.width ?? 32
  const height = meta.height ?? 32
  const tiny = await image.resize({ width: 32 }).blur(2).jpeg({ quality: 50 }).toBuffer()
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${width} ${height}"><filter id="b" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur stdDeviation="1"/></filter>` +
    `<image filter="url(#b)" x="0" y="0" width="100%" height="100%" ` +
    `xlink:href="data:image/jpeg;base64,${tiny.toString('base64')}"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}
