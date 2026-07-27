import { describe, it, expect } from 'vitest'
import { getTestClient } from './helpers/client.js'

describe('prisma 7 sqlite fixture', () => {
  it('creates and reads a media row with Json columns', async () => {
    const client = await getTestClient()
    await client.media.deleteMany({})
    const created = await client.media.create({
      data: {
        id: 'm1', uuid: 'u-1', modelType: 'User', modelId: '1',
        collectionName: 'default', name: 'a', fileName: 'a.jpg',
        mimeType: 'image/jpeg', disk: 'default', conversionsDisk: null,
        size: 1, manipulations: {}, customProperties: { nested: { k: [1, 2] } },
        generatedConversions: {}, responsiveImages: {}, orderColumn: null,
      },
    })
    expect(created.createdAt).toBeInstanceOf(Date)
    const found = await client.media.findUnique({ where: { id: 'm1' } })
    expect(found?.customProperties).toEqual({ nested: { k: [1, 2] } })
    await client.media.deleteMany({})
  })
})
