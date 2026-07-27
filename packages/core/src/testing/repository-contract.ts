import { describe, it, expect, beforeEach } from 'vitest'
import { MediaLibraryError } from '../errors.js'
import { NewMediaRecord } from '../types.js'
import { MediaRepository } from '../repository.js'

function makeRecord(over?: Partial<NewMediaRecord>): NewMediaRecord {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function runMediaRepositoryContract(
  name: string,
  factory: () => Promise<MediaRepository>,
): void {
  describe(`MediaRepository contract: ${name}`, () => {
    let repo: MediaRepository

    beforeEach(async () => {
      repo = await factory()
    })

    it('create stamps createdAt and updatedAt', async () => {
      const before = new Date()
      const created = await repo.create(makeRecord())
      expect(created.createdAt).toBeInstanceOf(Date)
      expect(created.updatedAt).toBeInstanceOf(Date)
      expect(created.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(created.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())

      const found = await repo.findById(created.id)
      expect(found).not.toBeNull()
      expect(found?.id).toBe(created.id)
      const foundByUuid = await repo.findByUuid(created.uuid)
      expect(foundByUuid?.id).toBe(created.id)
    })

    it('update bumps updatedAt', async () => {
      const created = await repo.create(makeRecord())
      await sleep(2)
      const updated = await repo.update(created.id, { name: 'renamed' })
      expect(updated.name).toBe('renamed')
      expect(updated.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime())
    })

    it('update rejects unknown id', async () => {
      await expect(repo.update('does-not-exist', { name: 'x' })).rejects.toThrow(MediaLibraryError)
    })

    it('findForModel returns records sorted by orderColumn asc (nulls last) then createdAt asc', async () => {
      const first = await repo.create(makeRecord({ orderColumn: null }))
      await sleep(2)
      const second = await repo.create(makeRecord({ orderColumn: null }))
      const withOrder2 = await repo.create(makeRecord({ orderColumn: 2 }))
      const withOrder1 = await repo.create(makeRecord({ orderColumn: 1 }))

      const results = await repo.findForModel('User', 'u1')
      expect(results.map((r) => r.id)).toEqual([
        withOrder1.id,
        withOrder2.id,
        first.id,
        second.id,
      ])
    })

    it('findForModel filters by collection when given', async () => {
      const inDefault = await repo.create(makeRecord({ collectionName: 'default' }))
      const inGallery = await repo.create(makeRecord({ collectionName: 'gallery' }))

      const defaultResults = await repo.findForModel('User', 'u1', 'default')
      expect(defaultResults.map((r) => r.id)).toEqual([inDefault.id])

      const galleryResults = await repo.findForModel('User', 'u1', 'gallery')
      expect(galleryResults.map((r) => r.id)).toEqual([inGallery.id])
    })

    it('findForModel is scoped to the exact (modelType, modelId) pair, not just modelId', async () => {
      const userU1 = await repo.create(makeRecord({ modelType: 'User', modelId: 'u1' }))
      await repo.create(makeRecord({ modelType: 'User', modelId: 'u2' }))
      await repo.create(makeRecord({ modelType: 'Post', modelId: 'u1' }))

      const results = await repo.findForModel('User', 'u1')
      expect(results.map((r) => r.id)).toEqual([userU1.id])
      expect(results.every((r) => r.modelType === 'User' && r.modelId === 'u1')).toBe(true)
    })

    it('findById round-trips nested customProperties/manipulations objects without mutation', async () => {
      const customProperties = { tags: ['a', 'b'], meta: { rating: 5, nested: { deep: true } } }
      const manipulations = { thumb: { width: 100, filters: ['grayscale'] } }

      const created = await repo.create(
        makeRecord({ customProperties, manipulations }),
      )
      const found = await repo.findById(created.id)

      expect(found?.customProperties).toEqual(customProperties)
      expect(found?.manipulations).toEqual(manipulations)
    })

    it('delete is idempotent', async () => {
      const created = await repo.create(makeRecord())
      await repo.delete(created.id)
      expect(await repo.findById(created.id)).toBeNull()
      // deleting again (already missing) must not throw
      await expect(repo.delete(created.id)).resolves.toBeUndefined()
      // deleting an id that never existed must not throw either
      await expect(repo.delete('never-existed')).resolves.toBeUndefined()
    })

    it('setOrder([idB, idA]) gives B orderColumn 1 (or startAt) and A 2', async () => {
      const recordA = await repo.create(makeRecord())
      const recordB = await repo.create(makeRecord())

      await repo.setOrder([recordB.id, recordA.id])

      const foundB = await repo.findById(recordB.id)
      const foundA = await repo.findById(recordA.id)
      expect(foundB?.orderColumn).toBe(1)
      expect(foundA?.orderColumn).toBe(2)

      await repo.setOrder([recordB.id, recordA.id], 10)
      const foundB2 = await repo.findById(recordB.id)
      const foundA2 = await repo.findById(recordA.id)
      expect(foundB2?.orderColumn).toBe(10)
      expect(foundA2?.orderColumn).toBe(11)
    })

    it('iterateAll honors filters', async () => {
      await repo.create(makeRecord({ modelType: 'User', collectionName: 'default' }))
      await repo.create(makeRecord({ modelType: 'Post', collectionName: 'default' }))
      await repo.create(makeRecord({ modelType: 'User', collectionName: 'gallery' }))

      const allRecords: string[] = []
      for await (const record of repo.iterateAll()) {
        allRecords.push(record.id)
      }
      expect(allRecords.length).toBe(3)

      const userOnly: string[] = []
      for await (const record of repo.iterateAll({ modelType: 'User' })) {
        expect(record.modelType).toBe('User')
        userOnly.push(record.id)
      }
      expect(userOnly.length).toBe(2)

      const userGallery: string[] = []
      for await (const record of repo.iterateAll({ modelType: 'User', collectionName: 'gallery' })) {
        expect(record.modelType).toBe('User')
        expect(record.collectionName).toBe('gallery')
        userGallery.push(record.id)
      }
      expect(userGallery.length).toBe(1)
    })
  })
}
