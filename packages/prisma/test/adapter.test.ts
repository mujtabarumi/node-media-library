import { describe, it, expect } from 'vitest'
import { prismaAdapter } from '../src/adapter.js'
import { getTestClient } from './helpers/client.js'

function makeRecord(over?: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    uuid: crypto.randomUUID(),
    modelType: 'User',
    modelId: 'u1',
    collectionName: 'default',
    fileName: 'a.jpg',
    name: 'a',
    disk: 'default',
    size: 1,
    manipulations: {},
    customProperties: {},
    generatedConversions: {},
    responsiveImages: {},
    orderColumn: null,
    mimeType: 'image/jpeg',
    conversionsDisk: null,
    ...over,
  }
}

describe('prismaAdapter — adapter-specific behavior', () => {
  it('ownerExists defaults to true and consults opts.owners', async () => {
    const client = await getTestClient()
    await client.media.deleteMany({})
    const bare = prismaAdapter(client)
    expect(await bare.ownerExists('User', 'nope')).toBe(true)

    const scoped = prismaAdapter(client, { owners: { User: (id) => id === 'u1' } })
    expect(await scoped.ownerExists('User', 'u1')).toBe(true)
    expect(await scoped.ownerExists('User', 'u2')).toBe(false)
  })

  it('iterateAll paginates across batches', async () => {
    const client = await getTestClient()
    await client.media.deleteMany({})
    const adapter = prismaAdapter(client)
    const created = []
    for (let i = 0; i < 7; i += 1) {
      created.push(await adapter.create(makeRecord()))
    }

    const paged = prismaAdapter(client, { iterateBatchSize: 3 })
    const seen: string[] = []
    for await (const record of paged.iterateAll()) {
      seen.push(record.id)
    }

    expect(seen.length).toBe(7)
    expect(new Set(seen)).toEqual(new Set(created.map((r) => r.id)))
  })

  it('delete is idempotent for unknown ids', async () => {
    const client = await getTestClient()
    await client.media.deleteMany({})
    const adapter = prismaAdapter(client)
    await expect(adapter.delete('never-existed')).resolves.toBeUndefined()
  })
})
