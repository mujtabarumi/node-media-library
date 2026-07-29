import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/index.js'
describe('smoke', () => {
  it('imports the package', () => expect(VERSION).toBe('0.0.0'))
})
