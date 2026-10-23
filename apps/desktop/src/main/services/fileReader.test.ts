import { afterEach, expect, test, vi } from 'vitest'

import {
  toAbsolutePath,
  toFileName,
  toFileExtension,
  toLineCount,
  toDataUrl,
  toMimeType,
  toFileSizeBytes,
  toPosixRelativePath,
} from '@/shared/types'

import { listSkillFiles, readBinaryFile, readSkillFile } from './fileReader'
import { readSkillFileDetailed, skillFilesScheduler } from './skillFiles'

vi.mock('./skillFiles', () => ({
  readSkillFileDetailed: vi.fn(),
  skillFilesScheduler: { list: vi.fn() },
}))
afterEach(() => vi.resetAllMocks())

test('legacy listing uses the same scheduler and retains a partial readable subset', async () => {
  // Arrange
  const file = {
    name: toFileName('SKILL.md'),
    path: toAbsolutePath('/skills/a/SKILL.md'),
    relativePath: toPosixRelativePath('SKILL.md'),
    extension: toFileExtension('.md'),
    size: toFileSizeBytes(4),
    previewable: 'text' as const,
  }
  vi.mocked(skillFilesScheduler.list).mockResolvedValue({
    status: 'partial',
    files: [file],
    issues: [{ relativePath: 'private', code: 'denied' }],
    observedEntries: 2,
  })
  // Act
  const result = await listSkillFiles(
    toAbsolutePath('/skills/a'),
    'window:frame',
  )
  // Assert
  expect(result).toEqual([
    {
      name: 'SKILL.md',
      path: '/skills/a/SKILL.md',
      relativePath: 'SKILL.md',
      extension: '.md',
      size: 4,
      previewable: 'text',
    },
  ])
  expect(skillFilesScheduler.list).toHaveBeenCalledWith('window:frame', {
    root: '/skills/a',
    requestId: expect.any(String),
    generation: 0,
  })
})

test('legacy text reads retain their nullable contract with bounded content loading', async () => {
  // Arrange
  const data = {
    name: toFileName('SKILL.md'),
    content: 'hello',
    extension: toFileExtension('md'),
    lineCount: toLineCount(1),
  }
  vi.mocked(readSkillFileDetailed)
    .mockResolvedValueOnce({ status: 'ready', kind: 'text', data })
    .mockResolvedValueOnce({ status: 'error', code: 'limit' })
  // Act / Assert
  expect(await readSkillFile(toAbsolutePath('/skills/a/SKILL.md'))).toEqual(
    data,
  )
  expect(await readSkillFile(toAbsolutePath('/skills/a/large.md'))).toBeNull()
})

test('legacy image reads preserve data URLs and degrade failures to null', async () => {
  // Arrange
  const data = {
    name: toFileName('image.png'),
    dataUrl: toDataUrl('data:image/png;base64,AQID'),
    mimeType: toMimeType('image/png'),
    size: toFileSizeBytes(3),
  }
  vi.mocked(readSkillFileDetailed)
    .mockResolvedValueOnce({ status: 'ready', kind: 'image', data })
    .mockResolvedValueOnce({ status: 'error', code: 'missing' })
  // Act / Assert
  expect(await readBinaryFile(toAbsolutePath('/skills/a/image.png'))).toEqual(
    data,
  )
  expect(await readBinaryFile(toAbsolutePath('/skills/a/gone.png'))).toBeNull()
})
