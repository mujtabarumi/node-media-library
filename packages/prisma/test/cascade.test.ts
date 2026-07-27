import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMediaLibrary, type MediaLibrary } from '@node-media-library/core'
import { prismaAdapter } from '../src/adapter.js'
import { withMediaCascade } from '../src/cascade.js'
import { getTestClient, type TestClient } from './helpers/client.js'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const png = Buffer.from(PNG_BASE64, 'base64')

let root: string
let client: TestClient
let media: MediaLibrary

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'nml-cascade-'))
  client = await getTestClient()
  await client.media.deleteMany({})
  await client.user.deleteMany({})
  await client.post.deleteMany({})
  media = createMediaLibrary({
    repository: prismaAdapter(client),
    storage: { disks: { default: { driver: 'fs', root } } },
    models: { User: {} },
  })
})

afterEach(async () => {
  await client.media.deleteMany({})
  await client.user.deleteMany({})
  await client.post.deleteMany({})
  await rm(root, { recursive: true, force: true })
})

describe('withMediaCascade', () => {
  it('user.delete cascades media rows and files', async () => {
    const xclient = withMediaCascade(client, media)
    await client.user.create({ data: { id: 'u1', name: 'A' } })
    const m = await media.for('User', 'u1').add(png).toCollection('default')

    await xclient.user.delete({ where: { id: 'u1' } })

    expect(await media.for('User', 'u1').getAll()).toEqual([])
    expect(existsSync(join(root, m.id))).toBe(false)
  })

  it('user.deleteMany cascades only matching users', async () => {
    const xclient = withMediaCascade(client, media)
    await client.user.create({ data: { id: 'u2', name: 'B' } })
    await client.user.create({ data: { id: 'u3', name: 'C' } })
    const m2 = await media.for('User', 'u2').add(png).toCollection('default')
    const m3 = await media.for('User', 'u3').add(png).toCollection('default')

    await xclient.user.deleteMany({ where: { id: 'u2' } })

    expect(await media.for('User', 'u2').getAll()).toEqual([])
    expect(existsSync(join(root, m2.id))).toBe(false)

    expect((await media.for('User', 'u3').getAll()).map((r) => r.id)).toEqual([m3.id])
    expect(existsSync(join(root, m3.id))).toBe(true)
  })

  it('models outside the registry pass through untouched', async () => {
    const xclient = withMediaCascade(client, media)
    await client.post.create({ data: { id: 'p1', title: 'Hello' } })
    const adapter = prismaAdapter(client)
    const postMedia = await adapter.create({
      id: crypto.randomUUID(),
      uuid: crypto.randomUUID(),
      modelType: 'Post',
      modelId: 'p1',
      collectionName: 'default',
      name: 'a',
      fileName: 'a.jpg',
      mimeType: 'image/jpeg',
      disk: 'default',
      conversionsDisk: null,
      size: 1,
      manipulations: {},
      customProperties: {},
      generatedConversions: {},
      responsiveImages: {},
      orderColumn: null,
    })

    await xclient.post.delete({ where: { id: 'p1' } })

    expect(await client.post.findUnique({ where: { id: 'p1' } })).toBeNull()
    expect(await client.media.findUnique({ where: { id: postMedia.id } })).not.toBeNull()
  })
})
