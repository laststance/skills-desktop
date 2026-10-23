import type * as Fs from 'node:fs/promises'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { toAbsolutePath, type AbsolutePath } from '@/shared/types'

import { discoverSkillFiles, readSkillFileDetailed } from './skillFiles'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>()
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    opendir: vi.fn(actual.opendir),
    open: vi.fn(actual.open),
  }
})
let root: AbsolutePath
beforeEach(async () => {
  root = toAbsolutePath(await mkdtemp(join(tmpdir(), 'skill-files-fault-')))
})
afterEach(async () => {
  vi.mocked(lstat).mockReset()
  vi.mocked(opendir).mockReset()
  vi.mocked(open).mockReset()
  await rm(root, { recursive: true, force: true })
})

test('reports a denied root without disguising the failure as an empty directory', async () => {
  // Arrange
  vi.mocked(opendir).mockRejectedValueOnce({ code: 'EACCES' })
  // Act
  const result = await discoverSkillFiles(root, () => false)
  // Assert
  expect(result).toEqual({
    status: 'error',
    files: [],
    issues: [],
    observedEntries: 0,
    code: 'denied',
  })
})

test('retains root files when a nested directory becomes unreadable', async () => {
  // Arrange
  await mkdir(join(root, 'private'))
  await writeFile(join(root, 'SKILL.md'), 'safe')
  const rootHandle = await opendir(root)
  vi.mocked(opendir)
    .mockResolvedValueOnce(rootHandle)
    .mockRejectedValueOnce({ code: 'EACCES' })
  // Act
  const result = await discoverSkillFiles(root, () => false)
  // Assert
  expect(result.status).toBe('partial')
  expect(result.files.map((file) => file.name)).toEqual(['SKILL.md'])
  expect(result.issues).toEqual([{ relativePath: 'private', code: 'denied' }])
})

test('reports a file that vanishes between enumeration and metadata inspection', async () => {
  // Arrange
  await writeFile(join(root, 'SKILL.md'), 'safe')
  const identity = await lstat(root)
  vi.mocked(lstat)
    .mockResolvedValueOnce(identity)
    .mockResolvedValueOnce(identity)
    .mockRejectedValueOnce({ code: 'ENOENT' })
  // Act
  const result = await discoverSkillFiles(root, () => false)
  // Assert
  expect(result.status).toBe('partial')
  expect(result.files).toEqual([])
  expect(result.issues).toEqual([{ relativePath: '', code: 'missing' }])
})

test('refuses a directory replaced by a symlink after it was scheduled', async () => {
  // Arrange
  await mkdir(join(root, 'child'))
  const identity = await lstat(root)
  const changed = {
    ...identity,
    isSymbolicLink: () => true,
    isDirectory: () => false,
  }
  vi.mocked(lstat)
    .mockResolvedValueOnce(identity)
    .mockResolvedValueOnce(identity)
    .mockResolvedValueOnce(changed)
  // Act
  const result = await discoverSkillFiles(root, () => false)
  // Assert
  expect(result.status).toBe('partial')
  expect(result.issues).toEqual([{ relativePath: 'child', code: 'denied' }])
})

test('rejects a root replaced before discovery is published', async () => {
  // Arrange
  const identity = await lstat(root)
  vi.mocked(lstat)
    .mockResolvedValueOnce(identity)
    .mockResolvedValueOnce(identity)
    .mockResolvedValueOnce({ ...identity, ino: identity.ino + 1 })
  // Act
  const result = await discoverSkillFiles(root, () => false)
  // Assert
  expect(result.code).toBe('missing')
  expect(result.files).toEqual([])
})

test('caps a file that grows after its stat and closes the descriptor', async () => {
  // Arrange
  const path = toAbsolutePath(join(root, 'growing.md'))
  await writeFile(path, 'initial')
  const handle = await open(path, 'r')
  const close = vi.spyOn(handle, 'close')
  vi.spyOn(handle, 'stat').mockResolvedValueOnce(await handle.stat())
  await writeFile(path, 'initial plus concurrent growth')
  vi.mocked(open).mockResolvedValueOnce(handle)
  // Act
  const result = await readSkillFileDetailed(root, path)
  // Assert
  expect(result).toEqual({ status: 'error', code: 'limit' })
  expect(close).toHaveBeenCalledTimes(1)
})

test('stops at ten thousand observed non-preview entries rather than materializing the whole directory', async () => {
  // Arrange
  await writeFile(join(root, 'unsupported.zip'), '')
  const handle = await opendir(root)
  const entry = await handle.read()
  const read = vi.fn(async () => entry)
  Object.defineProperty(handle, 'read', { value: read })
  const close = vi.spyOn(handle, 'close')
  vi.mocked(opendir).mockResolvedValueOnce(handle)
  // Act
  const result = await discoverSkillFiles(root, () => false)
  // Assert
  expect(result.observedEntries).toBe(10_000)
  expect(result.code).toBe('limit')
  expect(read).toHaveBeenCalledTimes(10_000)
  expect(close).toHaveBeenCalledTimes(1)
})

test('discards file content if the root identity changes before publication', async () => {
  // Arrange
  const path = toAbsolutePath(join(root, 'SKILL.md'))
  await writeFile(path, 'obsolete')
  const identity = await lstat(root)
  const metadata = await lstat(path)
  vi.mocked(lstat)
    .mockResolvedValueOnce(identity)
    .mockResolvedValueOnce(metadata)
    .mockResolvedValueOnce({ ...identity, ino: 999999 })
  // Act
  const result = await readSkillFileDetailed(root, path)
  // Assert
  expect(result).toEqual({ status: 'error', code: 'missing' })
})
