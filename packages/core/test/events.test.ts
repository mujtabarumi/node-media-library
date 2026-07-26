import { describe, it, expect } from 'vitest'
import { TypedEmitter } from '../src/events.js'
describe('TypedEmitter', () => {
  it('delivers payloads and unsubscribes', () => {
    const em = new TypedEmitter<{ ping: { n: number } }>()
    const seen: number[] = []
    const off = em.on('ping', (p) => seen.push(p.n))
    em.emit('ping', { n: 1 }); off(); em.emit('ping', { n: 2 })
    expect(seen).toEqual([1])
  })
  it('listener errors do not break emit', () => {
    const em = new TypedEmitter<{ ping: { n: number } }>()
    em.on('ping', () => { throw new Error('boom') })
    const seen: number[] = []
    em.on('ping', (p) => seen.push(p.n))
    em.emit('ping', { n: 3 })
    expect(seen).toEqual([3])
  })
})
