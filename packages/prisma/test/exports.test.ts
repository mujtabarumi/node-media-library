import { describe, it, expect } from 'vitest'
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
