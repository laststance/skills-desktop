import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { MAX_IMAGE_FILE_BYTES, MAX_TEXT_FILE_BYTES } from '@/shared/fileTypes'
import {
  unavailableSkillFiles,
  type SkillFilesListing,
} from '@/shared/skillFiles'
import { toAbsolutePath, type AbsolutePath } from '@/shared/types'

import {
  discoverSkillFiles,
  readSkillFileDetailed,
  skillFilesErrorCode,
  SkillFilesScheduler,
} from './skillFiles'

let root: AbsolutePath
beforeEach(async () => {
  root = toAbsolutePath(await mkdtemp(join(tmpdir(), 'skills-tree-test-')))
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

test('lists nested preview files, sorts SKILL first and preserves literal path segments', async () => {
  // Arrange
  await mkdir(join(root, 'guides'))
  await writeFile(join(root, 'guides', 'a\\b%文.md'), 'guide')
  await writeFile(join(root, 'z.md'), 'z')
  await writeFile(join(root, 'SKILL.md'), 'skill')
  // Act
  const result = await discoverSkillFiles(root, () => false)
  // Assert
  expect(result.status).toBe('complete')
  expect(result.files.map((file) => file.relativePath)).toEqual([
    'SKILL.md',
    'guides/a\\b%文.md',
    'z.md',
  ])
  expect(result.observedEntries).toBe(4)
})

test('distinguishes successful empty discovery from missing and cancelled roots', async () => {
  // Arrange / Act
  const empty = await discoverSkillFiles(root, () => false)
  const missing = await discoverSkillFiles(
    toAbsolutePath(join(root, 'gone')),
    () => false,
  )
  const cancelled = await discoverSkillFiles(root, () => true)
  // Assert
  expect(empty).toEqual({
    status: 'complete',
    files: [],
    issues: [],
    observedEntries: 0,
  })
  expect(missing).toEqual(unavailableSkillFiles('missing'))
  expect(cancelled).toEqual(unavailableSkillFiles('cancelled'))
})

test('skips nested symlinks, excluded directories and unsupported files', async () => {
  // Arrange
  await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, 'node_modules', 'private.md'), 'not listed')
  await writeFile(join(root, 'target.md'), 'safe')
  await symlink(join(root, 'target.md'), join(root, 'link.md'))
  await writeFile(join(root, 'archive.zip'), 'unsupported')
  // Act
  const result = await discoverSkillFiles(root, () => false)
  // Assert
  expect(result.files.map((file) => file.name)).toEqual(['target.md'])
})

test('marks pruned depth and keeps the readable subset', async () => {
  // Arrange
  await mkdir(join(root, 'a/b/c/d/e'), { recursive: true })
  await writeFile(join(root, 'SKILL.md'), 'safe')
  await writeFile(join(root, 'a/b/c/d/e/hidden.md'), 'too deep')
  // Act
  const result = await discoverSkillFiles(root, () => false)
  // Assert
  expect(result.status).toBe('partial')
  expect(result.issues).toEqual([{ relativePath: 'a/b/c/d/e', code: 'depth' }])
  expect(result.files.map((file) => file.name)).toEqual(['SKILL.md'])
})

test(
  'stops file discovery at 2000 files and reports a bounded partial result',
  { timeout: 15000 },
  async () => {
    // Arrange
    const fixtureRoot = root
    for (let start = 0; start < 2001; start += 64) {
      await Promise.all(
        Array.from({ length: Math.min(64, 2001 - start) }, async (_, offset) =>
          writeFile(join(fixtureRoot, `${start + offset}.md`), ''),
        ),
      )
    }
    // Act
    const result = await discoverSkillFiles(root, () => false)
    // Assert
    expect(result.files).toHaveLength(2000)
    expect(result.status).toBe('partial')
    expect(result.code).toBe('limit')
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
      4 * 1024 * 1024,
    )
  },
)

test('demotes oversized files and rejects oversized content reads', async () => {
  // Arrange
  const path = toAbsolutePath(join(root, 'large.md'))
  await writeFile(path, Buffer.alloc(MAX_TEXT_FILE_BYTES + 1))
  // Act
  const listing = await discoverSkillFiles(root, () => false)
  const read = await readSkillFileDetailed(root, path)
  // Assert
  expect(listing.files[0].previewable).toBe('binary')
  expect(read).toEqual({ status: 'error', code: 'limit' })
})

test('reads text and image content through the same typed result contract', async () => {
  // Arrange
  const text = toAbsolutePath(join(root, 'SKILL.md'))
  const image = toAbsolutePath(join(root, 'tiny.png'))
  await writeFile(text, 'one\ntwo')
  await writeFile(image, Buffer.from([1, 2, 3]))
  // Act
  const textResult = await readSkillFileDetailed(root, text)
  const imageResult = await readSkillFileDetailed(root, image)
  // Assert
  expect(textResult).toEqual({
    status: 'ready',
    kind: 'text',
    data: {
      name: 'SKILL.md',
      content: 'one\ntwo',
      extension: 'md',
      lineCount: 2,
    },
  })
  expect(imageResult).toEqual({
    status: 'ready',
    kind: 'image',
    data: {
      name: 'tiny.png',
      dataUrl: 'data:image/png;base64,AQID',
      mimeType: 'image/png',
      size: 3,
    },
  })
})

test('rejects paths outside the root, nested symlinks, directories and unsupported files', async () => {
  // Arrange
  await writeFile(join(root, 'safe.md'), 'safe')
  await symlink(join(root, 'safe.md'), join(root, 'link.md'))
  await mkdir(join(root, 'folder.md'))
  await writeFile(join(root, 'archive.zip'), 'no')
  // Act / Assert
  for (const path of [
    '/etc/passwd',
    root,
    join(root, 'link.md'),
    join(root, 'folder.md'),
    join(root, 'archive.zip'),
  ]) {
    expect(await readSkillFileDetailed(root, toAbsolutePath(path))).toEqual({
      status: 'error',
      code: 'denied',
    })
  }
  expect(
    await readSkillFileDetailed(root, toAbsolutePath(join(root, 'missing.md'))),
  ).toEqual({ status: 'error', code: 'missing' })
})

test('reads the validated normalized target when a dot segment follows a nested symlink', async () => {
  // Arrange
  await mkdir(join(root, 'private/nested'), { recursive: true })
  await writeFile(join(root, 'safe.md'), 'validated content')
  await writeFile(join(root, 'private/safe.md'), 'unvalidated content')
  await symlink(join(root, 'private/nested'), join(root, 'shortcut'))
  const path = toAbsolutePath(`${root}/shortcut/../safe.md`)
  // Act
  const result = await readSkillFileDetailed(root, path)
  // Assert
  expect(result).toEqual({
    status: 'ready',
    kind: 'text',
    data: {
      name: 'safe.md',
      content: 'validated content',
      extension: 'md',
      lineCount: 1,
    },
  })
})

test('enforces the five MiB image preview cap', async () => {
  // Arrange
  const path = toAbsolutePath(join(root, 'large.png'))
  await writeFile(path, Buffer.alloc(MAX_IMAGE_FILE_BYTES + 1))
  // Act / Assert
  expect(await readSkillFileDetailed(root, path)).toEqual({
    status: 'error',
    code: 'limit',
  })
})

test.each([
  ['ENOENT', 'missing'],
  ['ENOTDIR', 'missing'],
  ['EACCES', 'denied'],
  ['EPERM', 'denied'],
  ['ELOOP', 'denied'],
  ['EIO', 'unavailable'],
  [null, 'unavailable'],
])('redacts OS error %s to the safe code %s', (code, expected) => {
  // Arrange / Act / Assert
  expect(skillFilesErrorCode({ code, message: '/secret/file' })).toBe(expected)
  expect(skillFilesErrorCode('private raw exception')).toBe('unavailable')
})

test('limits active roots and retains their slots after timeout until the OS settles', async () => {
  // Arrange
  vi.useFakeTimers()
  const releases: Array<(result: SkillFilesListing) => void> = []
  const discover = vi.fn(
    async () =>
      new Promise<SkillFilesListing>((resolve) => releases.push(resolve)),
  )
  const scheduler = new SkillFilesScheduler(discover)
  const first = scheduler.list('one', { root, requestId: 'a', generation: 0 })
  const second = scheduler.list('two', { root, requestId: 'b', generation: 0 })
  // Act
  await vi.advanceTimersByTimeAsync(10_000)
  const third = scheduler.list('three', { root, requestId: 'c', generation: 0 })
  // Assert
  expect(await first).toEqual(unavailableSkillFiles('timeout'))
  expect(await second).toEqual(unavailableSkillFiles('timeout'))
  expect(discover).toHaveBeenCalledTimes(2)
  releases[0](unavailableSkillFiles('cancelled'))
  await vi.advanceTimersByTimeAsync(0)
  expect(discover).toHaveBeenCalledTimes(3)
  scheduler.cancel('three')
  expect(await third).toEqual(unavailableSkillFiles('cancelled'))
  releases[1](unavailableSkillFiles('cancelled'))
  releases[2](unavailableSkillFiles('cancelled'))
})

test('scopes cancellation to the owning frame and request generation', async () => {
  // Arrange
  const discover = vi.fn(
    async (_root: AbsolutePath, stopped: () => boolean) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return stopped()
        ? unavailableSkillFiles('cancelled')
        : {
            status: 'complete' as const,
            files: [],
            issues: [],
            observedEntries: 0,
          }
    },
  )
  const scheduler = new SkillFilesScheduler(discover)
  const request = { root, requestId: 'same', generation: 2 }
  const one = scheduler.list('one', request)
  const two = scheduler.list('two', request)
  // Act
  scheduler.cancel('one', { ...request, generation: 1 })
  scheduler.cancel('two', request)
  // Assert
  expect((await one).status).toBe('complete')
  expect(await two).toEqual(unavailableSkillFiles('cancelled'))
})

test('rejects duplicate request IDs and queue overflow before starting more filesystem work', async () => {
  // Arrange
  const releases: Array<(result: SkillFilesListing) => void> = []
  const discover = vi.fn(
    async () =>
      new Promise<SkillFilesListing>((resolve) => releases.push(resolve)),
  )
  const scheduler = new SkillFilesScheduler(discover)
  const pending = Array.from({ length: 66 }, async (_, index) =>
    scheduler.list('frame', {
      root,
      requestId: `request-${index}`,
      generation: 0,
    }),
  )
  // Act
  const overflow = await scheduler.list('frame', {
    root,
    requestId: 'overflow',
    generation: 0,
  })
  scheduler.cancel('frame')
  for (const release of releases) release(unavailableSkillFiles('cancelled'))
  await Promise.all(pending)
  const one = scheduler.list('other', {
    root,
    requestId: 'same',
    generation: 0,
  })
  const duplicate = await scheduler.list('other', {
    root,
    requestId: 'same',
    generation: 0,
  })
  scheduler.cancel('other')
  for (const release of releases) release(unavailableSkillFiles('cancelled'))
  await one
  // Assert
  expect(overflow).toEqual(unavailableSkillFiles('busy'))
  expect(duplicate).toEqual(unavailableSkillFiles('busy'))
})
