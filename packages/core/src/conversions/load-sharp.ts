import { MediaLibraryError } from '../errors.js'

type Sharp = typeof import('sharp').default

/**
 * Loads sharp, which is an OPTIONAL peer dependency — core never installs it,
 * and no package manager auto-installs a peer marked optional.
 *
 * Two failures need two messages. "Not installed" is the common case. "Present
 * but its native binary will not load" becomes more likely once sharp resolves
 * separately from core rather than hoisted alongside it, and the fix is
 * different, so conflating them would send the reader down the wrong path.
 *
 * `importer` exists only so both failure branches are testable without module
 * mocking. Production callers pass nothing.
 */
export async function loadSharp(
  importer: () => Promise<{ default: Sharp }> = () => import('sharp'),
): Promise<Sharp> {
  try {
    return (await importer()).default
  } catch (e) {
    const code =
      typeof e === 'object' && e !== null && 'code' in e
        ? String((e as { code: unknown }).code)
        : ''
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      throw new MediaLibraryError(
        'sharp is not installed. It is an optional peer dependency of @node-media-library/core, ' +
          'needed for image conversions and responsive images. Install it (`pnpm add sharp`), or ' +
          'supply your own generators via config.imageGenerators.',
      )
    }
    const message = e instanceof Error ? e.message : String(e)
    throw new MediaLibraryError(
      `sharp is installed but could not be loaded on this platform: ${message}. Reinstall it for ` +
        'this OS and architecture (`pnpm rebuild sharp`), or supply your own generators via ' +
        'config.imageGenerators.',
    )
  }
}
