import { describe, it, expect, beforeEach } from 'vitest'
import { prismaAdapter } from '../src/adapter.js'
import { getTestClient } from './helpers/client.js'

function makeRecord(over: Record<string, unknown>) {
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

describe("jsonPathStyle: 'mysql' pushes customProperties into SQL", () => {
  beforeEach(async () => {
    const client = await getTestClient()
    await client.media.deleteMany({})
  })

  it('returns the same rows as the portable default', async () => {
    const client = await getTestClient()
    const pushDown = prismaAdapter(client, { jsonPathStyle: 'mysql' })
    const portable = prismaAdapter(client)

    await pushDown.create(makeRecord({ customProperties: { storeId: 's1' } }))
    await pushDown.create(makeRecord({ customProperties: { storeId: 's1' } }))
    await pushDown.create(makeRecord({ customProperties: { storeId: 's2' } }))

    const pushed: string[] = []
    for await (const record of pushDown.iterateAll({ customProperties: { storeId: 's1' } })) {
      pushed.push(record.id)
    }

    const scanned: string[] = []
    for await (const record of portable.iterateAll({ customProperties: { storeId: 's1' } })) {
      scanned.push(record.id)
    }

    expect(pushed.length).toBe(2)
    expect(pushed.sort()).toEqual(scanned.sort())
  })

  it('combines the pushed-down filter with modelType', async () => {
    const client = await getTestClient()
    const repo = prismaAdapter(client, { jsonPathStyle: 'mysql' })

    await repo.create(makeRecord({ modelType: 'User', customProperties: { storeId: 's1' } }))
    await repo.create(makeRecord({ modelType: 'Post', customProperties: { storeId: 's1' } }))

    const found: string[] = []
    for await (const record of repo.iterateAll({
      modelType: 'User',
      customProperties: { storeId: 's1' },
    })) {
      found.push(record.id)
    }
    expect(found.length).toBe(1)
  })

  it('pushes down a number value, matching the portable path', async () => {
    const client = await getTestClient()
    const pushDown = prismaAdapter(client, { jsonPathStyle: 'mysql' })
    const portable = prismaAdapter(client)

    await pushDown.create(makeRecord({ customProperties: { priority: 5 } }))
    await pushDown.create(makeRecord({ customProperties: { priority: 9 } }))

    const filter = { customProperties: { priority: 5 } }

    const pushed: string[] = []
    for await (const record of pushDown.iterateAll(filter)) {
      pushed.push(record.id)
    }

    const scanned: string[] = []
    for await (const record of portable.iterateAll(filter)) {
      scanned.push(record.id)
    }

    expect(pushed.length).toBe(1)
    expect(pushed.sort()).toEqual(scanned.sort())
  })

  it('pushes down a boolean value, matching the portable path', async () => {
    const client = await getTestClient()
    const pushDown = prismaAdapter(client, { jsonPathStyle: 'mysql' })
    const portable = prismaAdapter(client)

    await pushDown.create(makeRecord({ customProperties: { archived: true } }))
    await pushDown.create(makeRecord({ customProperties: { archived: false } }))

    const filter = { customProperties: { archived: true } }

    const pushed: string[] = []
    for await (const record of pushDown.iterateAll(filter)) {
      pushed.push(record.id)
    }

    const scanned: string[] = []
    for await (const record of portable.iterateAll(filter)) {
      scanned.push(record.id)
    }

    expect(pushed.length).toBe(1)
    expect(pushed.sort()).toEqual(scanned.sort())
  })
})

describe('jsonPathStyle push-down applies only to scalar values', () => {
  beforeEach(async () => {
    const client = await getTestClient()
    await client.media.deleteMany({})
  })

  it('falls back to matchesMediaFilter for array-valued keys, preserving array order', async () => {
    const client = await getTestClient()
    const pushDown = prismaAdapter(client, { jsonPathStyle: 'mysql' })
    const portable = prismaAdapter(client)

    await pushDown.create(makeRecord({ customProperties: { storeId: 's1', tags: ['a', 'b'] } }))
    // Same storeId, but tags in reverse order — must NOT match if the
    // post-filter fallback runs, since array order is significant.
    await pushDown.create(makeRecord({ customProperties: { storeId: 's1', tags: ['b', 'a'] } }))
    await pushDown.create(makeRecord({ customProperties: { storeId: 's2', tags: ['a', 'b'] } }))

    const filter = { customProperties: { storeId: 's1', tags: ['a', 'b'] } }

    const pushed: string[] = []
    for await (const record of pushDown.iterateAll(filter)) {
      pushed.push(record.id)
    }

    const scanned: string[] = []
    for await (const record of portable.iterateAll(filter)) {
      scanned.push(record.id)
    }

    expect(pushed.length).toBe(1)
    expect(pushed.sort()).toEqual(scanned.sort())
  })

  it('falls back to matchesMediaFilter for a null-valued key', async () => {
    const client = await getTestClient()
    const pushDown = prismaAdapter(client, { jsonPathStyle: 'mysql' })
    const portable = prismaAdapter(client)

    await pushDown.create(makeRecord({ customProperties: { deletedAt: null } }))
    await pushDown.create(makeRecord({ customProperties: { deletedAt: '2024-01-01' } }))

    const filter = { customProperties: { deletedAt: null } }

    const pushed: string[] = []
    for await (const record of pushDown.iterateAll(filter)) {
      pushed.push(record.id)
    }

    const scanned: string[] = []
    for await (const record of portable.iterateAll(filter)) {
      scanned.push(record.id)
    }

    expect(pushed.length).toBe(1)
    expect(pushed.sort()).toEqual(scanned.sort())
  })

  it('pushes down an AND across multiple scalar keys', async () => {
    const client = await getTestClient()
    const repo = prismaAdapter(client, { jsonPathStyle: 'mysql' })

    await repo.create(makeRecord({ customProperties: { storeId: 's1', region: 'us' } }))
    await repo.create(makeRecord({ customProperties: { storeId: 's1', region: 'eu' } }))
    await repo.create(makeRecord({ customProperties: { storeId: 's2', region: 'us' } }))

    const found: string[] = []
    for await (const record of repo.iterateAll({
      customProperties: { storeId: 's1', region: 'us' },
    })) {
      found.push(record.id)
    }
    expect(found.length).toBe(1)
  })

  it('falls back to matchesMediaFilter for a dotted key instead of interpolating it as a nested path', async () => {
    const client = await getTestClient()
    const pushDown = prismaAdapter(client, { jsonPathStyle: 'mysql' })
    const portable = prismaAdapter(client)

    // The literal key contains a dot — this is what the filter below must
    // match, by exact key, not by walking into a nested object.
    await pushDown.create(makeRecord({ customProperties: { 'shopify.storeId': 's1' } }))
    // A genuinely nested record with the same leaf value. A naive adapter
    // that interpolates the dotted key straight into the SQL JSON path
    // (`$.shopify.storeId`) would incorrectly match THIS row instead of the
    // one above, since that path walks into a nested `shopify` object — so
    // this row is what makes the test discriminate the bug from the fix.
    await pushDown.create(makeRecord({ customProperties: { shopify: { storeId: 's1' } } }))

    const filter = { customProperties: { 'shopify.storeId': 's1' } }

    const pushed: string[] = []
    for await (const record of pushDown.iterateAll(filter)) {
      pushed.push(record.id)
    }

    const scanned: string[] = []
    for await (const record of portable.iterateAll(filter)) {
      scanned.push(record.id)
    }

    expect(pushed.length).toBe(1)
    expect(pushed.sort()).toEqual(scanned.sort())
  })
})
