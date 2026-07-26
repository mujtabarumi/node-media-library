import type { MediaRecord } from './types.js'

export interface MediaEventMap {
  'media:added': { media: MediaRecord }
  'media:deleting': { media: MediaRecord }
  'media:deleted': { media: MediaRecord }
  'collection:cleared': { modelType: string; modelId: string; collection: string }
}

export class TypedEmitter<T extends Record<string, unknown>> {
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
