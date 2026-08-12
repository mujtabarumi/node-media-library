import { MediaLibraryError } from '../errors.js'

type Sharp = typeof import('sharp').default

/**
 * Loads sharp, which is an OPTIONAL peer dependency — core never installs it,
 * and no package manager auto-installs a peer marked optional.
 *
 * Three outcomes get three distinct treatments:
 *
 * 1. Not installed at all (`ERR_MODULE_NOT_FOUND`/`MODULE_NOT_FOUND`) — the
 *    common case; tell the reader to install it.
 * 2. Installed but its native binary won't load — recognized by
 *    `ERR_DLOPEN_FAILED` or sharp's own "Could not load the sharp module"
 *    phrasing. This becomes more likely once sharp resolves separately from
 *    core rather than hoisted alongside it; the fix is a rebuild, which is a
 *    different fix from (1), so conflating them would send the reader down
 *    the wrong path.
 * 3. Anything else — a syntax error in a broken install, a permissions
 *    failure, an OOM while loading the native binding, or an unrelated bug.
 *    We don't know what's wrong here, so unlike (1) and (2) this message
 *    does NOT prescribe a specific fix (no "reinstall", no "rebuild") — it
 *    only reports the underlying error and points at the escape hatch.
 *
 * `importer` exists only so all three branches are testable without module
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
    const message = e instanceof Error ? e.message : String(e)

    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      throw new MediaLibraryError(
        'sharp is not installed. It is an optional peer dependency of @node-media-library/core, ' +
          'needed for image conversions and responsive images. Install it (`pnpm add sharp`), or ' +
          'supply your own generators via config.imageGenerators.',
      )
    }

    if (code === 'ERR_DLOPEN_FAILED' || message.includes('Could not load the sharp module')) {
      throw new MediaLibraryError(
        `sharp is installed but could not be loaded on this platform: ${message}. Reinstall it for ` +
          'this OS and architecture (`pnpm rebuild sharp`), or supply your own generators via ' +
          'config.imageGenerators.',
      )
    }

    throw new MediaLibraryError(
      `sharp failed to load, for a reason that does not match a known "not installed" or ` +
        `"native binary unloadable" signature: ${message}. This may not be an installation or ` +
        'platform problem, so reinstalling or rebuilding sharp is not guaranteed to help — ' +
        'investigate the underlying error, or supply your own generators via config.imageGenerators.',
    )
  }
}
