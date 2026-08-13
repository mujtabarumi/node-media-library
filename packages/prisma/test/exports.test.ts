import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  prismaAdapter,
  withMediaCascade,
  MEDIA_MODEL_SNIPPET,
  toMediaRecord,
  toCreateData,
} from '../src/index.js'
import type {
  PrismaAdapterOptions,
  CascadeOptions,
  PrismaLikeClient,
  MediaDelegate,
  MediaRow,
} from '../src/index.js'

describe('public exports', () => {
  it('exposes the stable public surface', () => {
    expect(prismaAdapter).toBeDefined()
    expect(withMediaCascade).toBeDefined()
    expect(MEDIA_MODEL_SNIPPET).toBeDefined()
    expect(toMediaRecord).toBeDefined()
    expect(toCreateData).toBeDefined()

    const opts: PrismaAdapterOptions = {}
    const cascadeOpts: CascadeOptions = {}
    const client: PrismaLikeClient | undefined = undefined
    const delegate: MediaDelegate | undefined = undefined
    const row: MediaRow | undefined = undefined

    expect(opts).toBeDefined()
    expect(cascadeOpts).toBeDefined()
    expect(client).toBeUndefined()
    expect(delegate).toBeUndefined()
    expect(row).toBeUndefined()
  })
})

describe('peer range', () => {
  const here = dirname(fileURLToPath(import.meta.url))

  function peerRange(): string {
    const pkg = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    return pkg.peerDependencies['@prisma/client']!
  }

  it('is wider than the range CI proves', () => {
    expect(peerRange()).toBe('>=6 <8')
  })

  it('is quoted verbatim in the README', () => {
    const readme = readFileSync(join(here, '../README.md'), 'utf8')
    expect(readme).toContain(`\`${peerRange()}\``)
  })

  const websiteFiles = [
    '../../../website/src/content/docs/production/prisma.mdx',
    '../../../website/src/content/docs/start/install.md',
    '../../../website/src/content/docs/reference/packages.md',
  ]

  it('is quoted verbatim in the website docs', () => {
    const range = peerRange()
    for (const relPath of websiteFiles) {
      const content = readFileSync(join(here, relPath), 'utf8')
      expect(content, relPath).toContain(range)
    }
  })
})
