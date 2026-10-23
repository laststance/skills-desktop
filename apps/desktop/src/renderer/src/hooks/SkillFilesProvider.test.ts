import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  unavailableSkillFiles,
  type SkillFilesListing,
} from '@/shared/skillFiles'
import { toAbsolutePath } from '@/shared/types'

import { SkillFilesCache } from './SkillFilesProvider'

const empty: SkillFilesListing = {
  status: 'complete',
  files: [],
  issues: [],
  observedEntries: 0,
}
const listDetailed = vi.fn()
const cancelList = vi.fn()
beforeEach(() => {
  listDetailed.mockReset().mockResolvedValue(empty)
  cancelList.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('window', { electron: { files: { listDetailed, cancelList } } })
})
afterEach(() => vi.unstubAllGlobals())

test('shares one in-flight listing between consumers and publishes immutable snapshots', async () => {
  // Arrange
  const cache = new SkillFilesCache()
  const root = toAbsolutePath('/skills/a')
  const initial = cache.snapshot()
  // Act
  const one = cache.ensure(root)
  const pending = cache.snapshot()
  const two = cache.ensure(root)
  await Promise.all([one, two])
  // Assert
  expect(listDetailed).toHaveBeenCalledTimes(1)
  expect(initial.entries.size).toBe(0)
  expect(pending).not.toBe(cache.snapshot())
  expect(cache.snapshot().entries.get(root)?.result).toEqual(empty)
})

test('invalidates requests and discards results from the old generation', async () => {
  // Arrange
  let release: (result: SkillFilesListing) => void = () => undefined
  listDetailed.mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const cache = new SkillFilesCache()
  const root = toAbsolutePath('/skills/a')
  const pending = cache.ensure(root)
  // Act
  cache.invalidate(1)
  release(empty)
  await pending
  // Assert
  expect(cancelList).toHaveBeenCalledTimes(1)
  expect(cache.snapshot().entries.size).toBe(0)
  expect(cache.generation).toBe(1)
})

test('evicts an unpinned least-recently-used root before admitting the sixty-fifth listing', async () => {
  // Arrange
  const cache = new SkillFilesCache()
  for (let index = 0; index < 64; index += 1)
    await cache.ensure(toAbsolutePath(`/skills/${index}`))
  cache.setActive(toAbsolutePath('/skills/0'))
  // Act
  await cache.ensure(toAbsolutePath('/skills/64'))
  // Assert
  expect(cache.entries.size).toBe(64)
  expect(cache.entries.has(toAbsolutePath('/skills/0'))).toBe(true)
  expect(cache.entries.has(toAbsolutePath('/skills/1'))).toBe(false)
})

test('reports capacity without IPC when every cached root is expanded and retries after collapse', async () => {
  // Arrange
  const cache = new SkillFilesCache()
  const roots = Array.from({ length: 64 }, (_, index) =>
    toAbsolutePath(`/skills/${index}`),
  )
  for (const root of roots) await cache.ensure(root)
  cache.pin(new Set(roots))
  const next = toAbsolutePath('/skills/next')
  // Act
  const result = await cache.ensure(next)
  // Assert
  expect(result).toEqual(unavailableSkillFiles('busy'))
  expect(cache.snapshot().entries.get(next)?.result?.code).toBe('busy')
  expect(listDetailed).toHaveBeenCalledTimes(64)
  cache.pin(new Set())
  await cache.ensure(next, true)
  expect(listDetailed).toHaveBeenCalledTimes(65)
})

test('reuses cached failures until the user explicitly requests retry', async () => {
  // Arrange
  listDetailed.mockRejectedValueOnce(new Error('/secret/path'))
  const cache = new SkillFilesCache()
  const root = toAbsolutePath('/skills/a')
  await cache.ensure(root)
  // Act
  await cache.ensure(root)
  // Assert
  expect(listDetailed).toHaveBeenCalledTimes(1)
  await cache.ensure(root, true)
  expect(cache.entries.get(root)?.result).toEqual(empty)
  expect(listDetailed).toHaveBeenCalledTimes(2)
})
