/** Pure arg builder for `pdftoppm` — one page, PNG, output at `${outPrefix}.png`. */
export function buildPdftoppmArgs(
  page: number,
  dpi: number,
  pdfPath: string,
  outPrefix: string,
): string[] {
  return [
    '-png',
    '-r',
    String(dpi),
    '-f',
    String(page),
    '-l',
    String(page),
    '-singlefile',
    pdfPath,
    outPrefix,
  ]
}
