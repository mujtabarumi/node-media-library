import { describe, it, expect } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLibrary, invoiceUrl, downloadInvoice, exportInvoices } from '../src/private-files.js'

/** Smallest byte sequence that sniffs as application/pdf. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n')

async function seed() {
  const root = await mkdtemp(join(tmpdir(), 'nml-private-'))
  const library = createLibrary(root)
  const media = await library
    .for('Invoice', 'inv-1')
    .add(PDF)
    .usingFileName('invoice.pdf')
    .toCollection('invoices')
  return { library, media }
}

describe('Private files & downloads', () => {
  it('accepts a PDF into the invoices collection', async () => {
    const { media } = await seed()
    expect(media.mimeType).toBe('application/pdf')
    expect(media.disk).toBe('documents')
  })

  it('degrades signedUrl() to a plain URL on the fs driver', async () => {
    const { library, media } = await seed()

    const url = await invoiceUrl(library, 'inv-1')

    // This is the page's "sharp edge", asserted so it cannot silently stop
    // being true: on an fs disk there is no signing, so expiresIn is ignored
    // and the URL carries no signature or expiry parameters.
    expect(url).toBe(`http://localhost:3000/media/${media.id}/${media.fileName}`)
    expect(url).not.toContain('X-Amz-Signature')
    expect(url).not.toContain('Expires')
  })

  it('streams the file as an attachment', async () => {
    const { library, media } = await seed()

    const response = await downloadInvoice(library, media.id)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="invoice.pdf"')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PDF)
  })

  it('exports a collection as a streamed zip', async () => {
    const { library } = await seed()

    const response = await exportInvoices(library, 'inv-1', '2024-001')

    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="invoice-2024-001.zip"',
    )
    // Body is a real archive, not an empty stream.
    const bytes = Buffer.from(await response.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(0)
    expect(bytes.subarray(0, 2).toString()).toBe('PK')
  })
})
