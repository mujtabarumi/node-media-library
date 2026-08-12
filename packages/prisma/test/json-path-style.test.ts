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
})
