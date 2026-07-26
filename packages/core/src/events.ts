import type { MediaRecord } from './types.js'

// Must stay an `interface` (not a `type` alias): Plan 3 extends this via
// TypeScript declaration merging, which only works on interfaces.
export interface MediaEventMap {
  'media:added': { media: MediaRecord }
  'media:deleting': { media: MediaRecord }
  'media:deleted': { media: MediaRecord }
  'collection:cleared': { modelType: string; modelId: string; collection: string }
}

// `T extends object` (not `Record<string, unknown>`): the class only ever
// uses `keyof T` and `T[K]`, neither of which needs an index signature, so
// the looser bound is sufficient — and, unlike `Record<string, unknown>`, it
// is satisfied by named `interface` type arguments (e.g. `MediaEventMap`),
// not just inline object-literal types.
export class TypedEmitter<T extends object> {
  private listeners = new Map<keyof T, Set<(payload: any) => void>>()

  on<K extends keyof T>(event: K, fn: (payload: T[K]) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(fn as (payload: any) => void)
    return () => this.listeners.get(event)?.delete(fn as (payload: any) => void)
  }

  emit<K extends keyof T>(event: K, payload: T[K]): void {
    const listeners = this.listeners.get(event)
    if (!listeners) return
    for (const fn of Array.from(listeners)) {
      try {
        fn(payload)
      } catch (err) {
        console.error(`Error in listener for "${String(event)}":`, err)
      }
    }
  }
}
