import type { CollectionDefinition } from '../definitions/collection.js'
import { StorageError } from '../errors.js'
import type { DiskConfig, ResolvedStorage } from './resolve.js'

const MIXED_VISIBILITY_WARNING =
  '[media-library] R2 disk "%s" has a baseUrl and serves both public and private collections. ' +
  'R2 has no per-object ACLs — if the bucket is reachable through a public domain, the ' +
  '"private" objects on it are too. Use two disks: a public bucket for .public() collections ' +
  'and a private bucket for the rest (see collection().useDisk()).'

/**
 * Resolves a disk config by name, or `null` when the name is not configured.
 * An unconfigured disk name is a pre-existing runtime failure mode; this
 * check must not upgrade it into a construction failure, which would break
 * consumers whose unused collections reference disks they never defined.
 */
function configOrNull(storage: ResolvedStorage, name: string): DiskConfig | null {
  try {
    return storage.diskConfig(name)
  } catch {
    return null
  }
}

/**
 * Rejects, at construction, configurations whose public URLs could only fail
 * later at request time, and warns about R2 disks whose visibility model is
 * incoherent.
 *
 * Lives here rather than in `resolveStorage` because it needs the collection
 * registry, and `resolveStorage` is deliberately unaware of collections.
 *
 * `opts.hasCustomUrlGenerator` downgrades the public-collection-on-bare-r2
 * throw to a `console.warn`. The throw is only sound for the
 * `DefaultUrlGenerator`, whose public URLs demonstrably cannot work without a
 * `baseUrl`. A consumer-supplied `UrlGenerator` is a documented extension
 * point and may build public URLs from its own CDN logic that core cannot
 * see — asserting those are broken would make a working configuration
 * unconstructable. The mixed-visibility warning is unaffected: it is about
 * where the bytes live, not how URLs are built.
 * @internal
 */
export function checkCollectionVisibility(
  models: Readonly<Record<string, Readonly<Record<string, CollectionDefinition>>>>,
  storage: ResolvedStorage,
  opts: { hasCustomUrlGenerator?: boolean } = {},
): void {
  const publicDisks = new Set<string>()
  const privateDisks = new Set<string>()

  for (const [modelType, collections] of Object.entries(models)) {
    for (const [collectionName, def] of Object.entries(collections)) {
      const primary = def.disk ?? storage.defaultDisk
      const conversions = def.conversionsDisk ?? primary
      for (const diskName of new Set([primary, conversions])) {
        const cfg = configOrNull(storage, diskName)
        if (!cfg) continue
        if (!def.public) {
          privateDisks.add(diskName)
          continue
        }
        publicDisks.add(diskName)
        if (cfg.driver === 'r2' && !cfg.baseUrl) {
          const message =
            `Collection "${collectionName}" on model "${modelType}" is public, but its disk ` +
            `"${diskName}" is an r2 disk with no baseUrl. Cloudflare R2 has no object ACLs — ` +
            `public URLs come from an r2.dev subdomain or a custom domain. Set baseUrl on the ` +
            `disk, or drop .public() and serve the files with signedUrl().`
          if (opts.hasCustomUrlGenerator) {
            console.warn(
              `[media-library] ${message} A custom urlGenerator is configured, so this is a ` +
                `warning rather than an error — core cannot tell how it builds public URLs. The ` +
                `DefaultUrlGenerator would throw here.`,
            )
            continue
          }
          throw new StorageError(message)
        }
      }
    }
  }

  for (const diskName of publicDisks) {
    if (!privateDisks.has(diskName)) continue
    const cfg = configOrNull(storage, diskName)
    if (cfg?.driver === 'r2' && cfg.baseUrl) {
      console.warn(MIXED_VISIBILITY_WARNING.replace('%s', diskName))
    }
  }
}
