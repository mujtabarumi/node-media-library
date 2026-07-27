import { describe, it, expect } from 'vitest'
import { MediaLibraryError } from '@node-media-library/core'
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

  it('create rejects a duplicate id with an honest message naming the id', async () => {
    const client = await getTestClient()
    await client.media.deleteMany({})
    const adapter = prismaAdapter(client)
    const record = makeRecord()
    await adapter.create(record)

    try {
      await adapter.create(makeRecord({ id: record.id }))
      throw new Error('expected create to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(MediaLibraryError)
      expect((e as MediaLibraryError).code).toBe('DUPLICATE_ID')
      expect((e as MediaLibraryError).message).toContain('id')
      expect((e as MediaLibraryError).message).toContain(record.id)
    }
  })

  it('iterateAll keeps yielding after the last-yielded record is deleted mid-iteration', async () => {
    const client = await getTestClient()
    await client.media.deleteMany({})
    const adapter = prismaAdapter(client)
    const created = []
    for (let i = 0; i < 5; i += 1) {
      created.push(await adapter.create(makeRecord()))
    }

    const paged = prismaAdapter(client, { iterateBatchSize: 2 })
    const seen: string[] = []
    let deletedId: string | undefined
    for await (const record of paged.iterateAll()) {
      seen.push(record.id)
      // After the first batch (2 records) has been fully yielded, delete the
      // record that was just yielded last — this is the row a cursor+skip
      // pagination would depend on still existing for the next page.
      if (seen.length === 2 && deletedId === undefined) {
        deletedId = record.id
        await adapter.delete(record.id)
      }
    }

    // The deleted record was already yielded before it got deleted, so it's
    // legitimately in `seen` once; every OTHER record must also appear
    // exactly once (no early stop, no gap left by the mid-iteration delete).
    const otherIds = created.map((r) => r.id).filter((id) => id !== deletedId)
    for (const id of otherIds) {
      expect(seen.filter((seenId) => seenId === id).length).toBe(1)
    }
    expect(seen.filter((seenId) => seenId === deletedId).length).toBe(1)
    expect(new Set(seen)).toEqual(new Set(created.map((r) => r.id)))
  })

  it('create rejects a duplicate uuid with an honest message naming the uuid, not the id', async () => {
    const client = await getTestClient()
    await client.media.deleteMany({})
    const adapter = prismaAdapter(client)
    const sharedUuid = crypto.randomUUID()
    await adapter.create(makeRecord({ uuid: sharedUuid }))

    try {
      await adapter.create(makeRecord({ uuid: sharedUuid }))
      throw new Error('expected create to reject')
    } catch (e) {
      expect(e).toBeInstanceOf(MediaLibraryError)
      expect((e as MediaLibraryError).code).toBe('DUPLICATE_ID')
      expect((e as MediaLibraryError).message).toContain('uuid')
      expect((e as MediaLibraryError).message).toContain(sharedUuid)
    }
  })
})
