import { join } from 'node:path'

import { beforeEach, describe, expect, test, vi } from 'vitest'

const SOURCE_DIR = '/mock/source/skills'

const readdirMock = vi.fn()
const statMock = vi.fn()

vi.mock('fs/promises', () => ({
  readdir: readdirMock,
  stat: statMock,
}))

vi.mock('../constants', () => ({
  SOURCE_DIR: '/mock/source/skills',
}))

/**
 * Build an fs error carrying a real Node `code`, which is what the probe branches on.
 * @param code - Node-style errno code.
 * @returns Error object with the requested code attached.
 * @example createFsError('EACCES')
 */
function createFsError(code: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: mock failure`), { code })
}

/**
 * Build a Dirent-like entry for the readdir mock.
 * @param name - Entry name as it appears under the source directory.
 * @param isDirectory - Whether readdir should report the entry as a directory.
 * @returns Dirent-compatible object consumed by the source listing.
 * @example createDirent('tdd-workflow', true)
 */
function createDirent(
  name: string,
  isDirectory: boolean,
): { name: string; isDirectory: () => boolean } {
  return { name, isDirectory: () => isDirectory }
}

/**
 * Stats stub whose `isFile()` answer drives the SKILL.md probe.
 * @param isFile - Whether SKILL.md should look like a regular file.
 * @returns fs.Stats-compatible object.
 * @example createStats(true).isFile() // => true
 */
function createStats(isFile: boolean): { isFile: () => boolean } {
  return { isFile: () => isFile }
}

describe('listSourceSkillDirs', () => {
  beforeEach(() => {
    readdirMock.mockReset()
    statMock.mockReset()
  })

  test('keeps a skill whose SKILL.md cannot be read so a permissions problem does not look like a deletion', async () => {
    // Arrange: one source directory whose SKILL.md probe is refused by the OS.
    readdirMock.mockResolvedValue([createDirent('locked-skill', true)])
    statMock.mockRejectedValue(createFsError('EACCES'))
    const { listSourceSkillDirs } = await import('./dirScanner')

    // Act
    const listing = await listSourceSkillDirs()

    // Assert: the skill is still listed, flagged so the UI can say why.
    expect(listing).toEqual({
      status: 'listed',
      entries: [
        {
          name: 'locked-skill',
          path: join(SOURCE_DIR, 'locked-skill'),
          isUnreadable: true,
        },
      ],
    })
  })

  test('lists a readable skill without the unreadable flag', async () => {
    // Arrange: SKILL.md exists as a regular file.
    readdirMock.mockResolvedValue([createDirent('tdd-workflow', true)])
    statMock.mockResolvedValue(createStats(true))
    const { listSourceSkillDirs } = await import('./dirScanner')

    // Act
    const listing = await listSourceSkillDirs()

    // Assert
    expect(listing).toEqual({
      status: 'listed',
      entries: [
        {
          name: 'tdd-workflow',
          path: join(SOURCE_DIR, 'tdd-workflow'),
          isUnreadable: false,
        },
      ],
    })
  })

  test('drops a directory that has no SKILL.md at all', async () => {
    // Arrange: the probe succeeds in proving SKILL.md cannot exist.
    readdirMock.mockResolvedValue([createDirent('not-a-skill', true)])
    statMock.mockRejectedValue(createFsError('ENOENT'))
    const { listSourceSkillDirs } = await import('./dirScanner')

    // Act
    const listing = await listSourceSkillDirs()

    // Assert: a folder without SKILL.md is not a skill and must not be offered.
    expect(listing).toEqual({ status: 'listed', entries: [] })
  })

  test('drops a directory whose SKILL.md is a directory rather than a file', async () => {
    // Arrange: stat resolves, but the entry is not a regular file.
    readdirMock.mockResolvedValue([createDirent('skill-md-is-a-dir', true)])
    statMock.mockResolvedValue(createStats(false))
    const { listSourceSkillDirs } = await import('./dirScanner')

    // Act
    const listing = await listSourceSkillDirs()

    // Assert
    expect(listing).toEqual({ status: 'listed', entries: [] })
  })

  test('reports an unreadable source directory instead of reporting no skills installed', async () => {
    // Arrange: ~/.agents/skills exists but the process may not open it.
    readdirMock.mockRejectedValue(createFsError('EACCES'))
    const { listSourceSkillDirs } = await import('./dirScanner')

    // Act
    const listing = await listSourceSkillDirs()

    // Assert: the caller can tell "could not look" from "nothing there".
    expect(listing).toEqual({ status: 'unreadable', code: 'EACCES' })
  })

  test('reports an empty list when the source directory does not exist yet', async () => {
    // Arrange: a fresh install before the first `skills add`.
    readdirMock.mockRejectedValue(createFsError('ENOENT'))
    const { listSourceSkillDirs } = await import('./dirScanner')

    // Act
    const listing = await listSourceSkillDirs()

    // Assert: a missing source directory is a real empty state, not a failure.
    expect(listing).toEqual({ status: 'listed', entries: [] })
  })

  test('skips hidden entries and files so .git and .DS_Store never become skills', async () => {
    // Arrange: one hidden directory, one regular file, one real skill.
    readdirMock.mockResolvedValue([
      createDirent('.git', true),
      createDirent('README.md', false),
      createDirent('tdd-workflow', true),
    ])
    statMock.mockResolvedValue(createStats(true))
    const { listSourceSkillDirs } = await import('./dirScanner')

    // Act
    const listing = await listSourceSkillDirs()

    // Assert
    expect(listing).toEqual({
      status: 'listed',
      entries: [
        {
          name: 'tdd-workflow',
          path: join(SOURCE_DIR, 'tdd-workflow'),
          isUnreadable: false,
        },
      ],
    })
  })
})

describe('isValidSkillDir', () => {
  beforeEach(() => {
    statMock.mockReset()
  })

  test('refuses a directory whose SKILL.md could not be probed so destructive guards stay fail-closed', async () => {
    // Arrange: the probe is refused, so validity is unknown.
    statMock.mockRejectedValue(createFsError('EACCES'))
    const { isValidSkillDir } = await import('./skillValidation')

    // Act
    const isValid = await isValidSkillDir(join(SOURCE_DIR, 'locked-skill'))

    // Assert: unknown must never read as "yes, delete/copy it".
    expect(isValid).toBe(false)
  })

  test('accepts a directory whose SKILL.md is a regular file', async () => {
    // Arrange
    statMock.mockResolvedValue(createStats(true))
    const { isValidSkillDir } = await import('./skillValidation')

    // Act
    const isValid = await isValidSkillDir(join(SOURCE_DIR, 'tdd-workflow'))

    // Assert
    expect(isValid).toBe(true)
  })
})
