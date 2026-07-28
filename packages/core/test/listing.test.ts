import { describe, it, expect } from 'vitest'
import type { Disk } from 'flydrive'
import { createMediaLibrary } from '../src/library.js'
import { InMemoryMediaRepository } from '../src/repository/in-memory.js'

/**
 * `MediaLibrary#listDirectChildren` is exercised directly here (bypassing
 * `clean()` entirely) against a duck-typed fake `Disk`, because the
 * behaviors under test — S3's raw-prefix sibling matching, nested-object
 * exclusion, and `paginationToken` looping — are all about flydrive's
 * public `listAll()` contract, not filesystem behavior. The `fs` driver
 * used by the rest of the clean() integration tests never exercises any of
 * these paths (no siblings, no nesting, no pagination), so this is the only
 * place that actually proves the S3-safety fix.
 */
function makeLibrary() {
  return createMediaLibrary({
    repository: new InMemoryMediaRepository(),
    storage: { disks: { default: { driver: 'fs', root: '/tmp/nml-listing-unused' } } },
    models: {},
  })
}

type FakeObject = { key: string; name: string; isFile: boolean }
type FakePage = { paginationToken?: string; objects: FakeObject[] }

function fakeDisk(pages: FakePage[]): { disk: Disk; calls: Array<{ prefix: string; paginationToken?: string }> } {
  const calls: Array<{ prefix: string; paginationToken?: string }> = []
  let call = 0
  const disk = {
    listAll: async (prefix: string, opts?: { recursive?: boolean; paginationToken?: string }) => {
      calls.push({ prefix, paginationToken: opts?.paginationToken })
      const page = pages[call]
      call += 1
      if (!page) return { objects: [] }
      return { paginationToken: page.paginationToken, objects: page.objects }
    },
  } as unknown as Disk
  return { disk, calls }
}

/** Reaches the private method directly — TS privacy is compile-time only. */
function listDirectChildren(
  library: ReturnType<typeof makeLibrary>,
  disk: Disk,
  dir: string,
): Promise<Array<{ key: string; name: string }>> {
  return (library as unknown as { listDirectChildren(d: Disk, dir: string): Promise<Array<{ key: string; name: string }>> })
    .listDirectChildren(disk, dir)
}

describe('MediaLibrary#listDirectChildren (S3-safe listing)', () => {
  it('excludes a sibling key that only matches the raw (non-slash-terminated) prefix', async () => {
    const library = makeLibrary()
    const { disk } = fakeDisk([
      {
        objects: [
          { key: 'abc/conversions/thumb.jpg', name: 'thumb.jpg', isFile: true },
          // Raw prefix "abc/conversions" matches this sibling file too (S3
          // driver behavior) — must NOT be treated as a conversions-dir child.
          { key: 'abc/conversions-extra.txt', name: 'conversions-extra.txt', isFile: true },
        ],
      },
    ])

    const result = await listDirectChildren(library, disk, 'abc/conversions')

    expect(result).toEqual([{ key: 'abc/conversions/thumb.jpg', name: 'thumb.jpg' }])
  })

  it('excludes nested objects (only direct children of dir are candidates)', async () => {
    const library = makeLibrary()
    const { disk } = fakeDisk([
      {
        objects: [
          { key: 'abc/conversions/thumb.jpg', name: 'thumb.jpg', isFile: true },
          { key: 'abc/conversions/nested/deep.jpg', name: 'deep.jpg', isFile: true },
        ],
      },
    ])

    const result = await listDirectChildren(library, disk, 'abc/conversions')

    expect(result).toEqual([{ key: 'abc/conversions/thumb.jpg', name: 'thumb.jpg' }])
  })

  it('excludes directory entries (isFile: false)', async () => {
    const library = makeLibrary()
    const { disk } = fakeDisk([
      {
        objects: [
          { key: 'abc/conversions/thumb.jpg', name: 'thumb.jpg', isFile: true },
          { key: 'abc/conversions/nested', name: 'nested', isFile: false },
        ],
      },
    ])

    const result = await listDirectChildren(library, disk, 'abc/conversions')

    expect(result).toEqual([{ key: 'abc/conversions/thumb.jpg', name: 'thumb.jpg' }])
  })

  it('loops across paginationToken pages and diffs all of them, using full keys', async () => {
    const library = makeLibrary()
    const { disk, calls } = fakeDisk([
      {
        paginationToken: 'page-2',
        objects: [{ key: 'abc/conversions/a.jpg', name: 'a.jpg', isFile: true }],
      },
      {
        objects: [{ key: 'abc/conversions/b.jpg', name: 'b.jpg', isFile: true }],
      },
    ])

    const result = await listDirectChildren(library, disk, 'abc/conversions')

    expect(result).toEqual([
      { key: 'abc/conversions/a.jpg', name: 'a.jpg' },
      { key: 'abc/conversions/b.jpg', name: 'b.jpg' },
    ])
    expect(calls).toEqual([
      { prefix: 'abc/conversions', paginationToken: undefined },
      { prefix: 'abc/conversions', paginationToken: 'page-2' },
    ])
  })

  it('returns [] when listAll throws (missing dir, unsupported driver, etc.)', async () => {
    const library = makeLibrary()
    const disk = {
      listAll: async () => {
        throw new Error('boom')
      },
    } as unknown as Disk

    const result = await listDirectChildren(library, disk, 'abc/conversions')

    expect(result).toEqual([])
  })
})
