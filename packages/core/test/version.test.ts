import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { VERSION } from '../src/index.js'

describe('VERSION', () => {
  it('matches the version in package.json', () => {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const { version } = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
    expect(VERSION).toBe(version)
  })
})
