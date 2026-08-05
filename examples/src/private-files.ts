/**
 * Backs the code on the "Private files & downloads" page.
 *
 * Note what is NOT claimed here: the signed-URL region documents the S3/GCS
 * path, but the test exercises it against an `fs` disk, where signing
 * degrades to a plain public URL. The test asserts that degradation
 * explicitly, so the page's "sharp edge" callout stays true.
 */
import { createMediaLibrary, InMemoryMediaRepository, collection } from '@node-media-library/core'

// #region collection
export const invoicesCollection = collection()
  .acceptsMimeTypes(['application/pdf'])
  .useDisk('documents')
  .storeConversionsOnDisk('documents')
// #endregion collection

/**
 * The docs show `documents` as a private S3 disk. Here it is a local
 * directory so the example is runnable without credentials — the collection
 * wiring above is identical either way.
 */
export function createLibrary(storageRoot = './storage/media') {
  return createMediaLibrary({
    repository: new InMemoryMediaRepository(),
    storage: {
      disks: {
        default: { driver: 'fs', root: storageRoot, baseUrl: 'http://localhost:3000/media' },
        documents: { driver: 'fs', root: storageRoot, baseUrl: 'http://localhost:3000/media' },
      },
    },
    models: { Invoice: { collections: { invoices: invoicesCollection } } },
  })
}

// #region signed-url
export async function invoiceUrl(library: ReturnType<typeof createLibrary>, invoiceId: string) {
  return library.for('Invoice', invoiceId).firstSignedUrl('invoices', undefined, {
    expiresIn: '15 mins',
  })
}
// #endregion signed-url

// #region download
export async function downloadInvoice(
  library: ReturnType<typeof createLibrary>,
  mediaId: string,
): Promise<Response> {
  // Web-standard Response — return it directly from Hono, Next.js, Bun, or Deno
  return library.download(mediaId) // Content-Disposition: attachment
}
// #endregion download

// #region zip
export async function exportInvoices(
  library: ReturnType<typeof createLibrary>,
  invoiceId: string,
  invoiceNumber: string,
): Promise<Response> {
  const docs = await library.for('Invoice', invoiceId).getAll('invoices')
  return library.zip(`invoice-${invoiceNumber}.zip`, docs)
}
// #endregion zip
