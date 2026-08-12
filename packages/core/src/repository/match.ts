import type { MediaFilter } from '../repository.js'
import type { MediaRecord } from '../types.js'

/**
 * Deep structural equality for JSON values. `customProperties` values may be
 * nested objects or arrays, and `===` never matches those — without this the
 * in-memory and SQL backends would silently disagree.
 */
function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false

  const aIsArray = Array.isArray(a)
  if (aIsArray !== Array.isArray(b)) return false
  if (aIsArray) {
    const av = a as unknown[]
    const bv = b as unknown[]
    return av.length === bv.length && av.every((item, i) => jsonEquals(item, bv[i]))
  }

  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const aKeys = Object.keys(ao)
  if (aKeys.length !== Object.keys(bo).length) return false
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(bo, key) && jsonEquals(ao[key], bo[key]),
  )
}

/**
 * Whether `record` satisfies `filter`.
 *
 * Exported so third-party `MediaRepository` backends can implement
 * `iterateAll` filtering with the exact semantics
 * `runMediaRepositoryContract` asserts, rather than reimplementing them and
 * diverging.
 */
export function matchesMediaFilter(record: MediaRecord, filter?: MediaFilter): boolean {
  if (!filter) return true
  if (filter.modelType !== undefined && record.modelType !== filter.modelType) return false
  if (filter.collectionName !== undefined && record.collectionName !== filter.collectionName) {
    return false
  }
  if (filter.customProperties !== undefined) {
    for (const [key, value] of Object.entries(filter.customProperties)) {
      if (!Object.prototype.hasOwnProperty.call(record.customProperties, key)) return false
      if (!jsonEquals(record.customProperties[key], value)) return false
    }
  }
  return true
}
