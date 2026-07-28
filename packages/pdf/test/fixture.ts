/** Minimal valid one-page PDF (200x100pt blank page) with a correct xref table. */
export function makeMinimalPdf(): Buffer {
  const header = '%PDF-1.4\n'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << >> >>\nendobj\n',
  ]
  let body = ''
  const offsets: number[] = []
  for (const obj of objects) {
    offsets.push(header.length + body.length)
    body += obj
  }
  const xrefStart = header.length + body.length
  const pad = (n: number) => String(n).padStart(10, '0')
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${pad(o)} 00000 n \n`).join('')
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(header + body + xref + trailer, 'latin1')
}
