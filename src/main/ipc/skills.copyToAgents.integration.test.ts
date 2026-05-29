import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handleMock = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => handleMock(...args),
  },
}))

/**
 * Look up a registered IPC handler by channel name.
 * @param channel - IPC invoke channel to find.
 * @returns Registered handler function.
 * @example
 * const handler = getRegisteredHandler('skills:copyToAgents')
 */
function getRegisteredHandler(
  channel: string,
): (...args: unknown[]) => unknown {
  const registration = handleMock.mock.calls.find(([name]) => name === channel)
  if (!registration) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return registration[1] as (...args: unknown[]) => unknown
}

describe('skills:copyToAgents handler', () => {
  let tempHome = ''

  beforeEach(async () => {
    vi.resetModules()
    handleMock.mockReset()
    tempHome = await mkdtemp(join(tmpdir(), 'skills-desktop-copy-'))
    vi.doMock('os', async () => {
      const actual = await vi.importActual<typeof NodeOs>('os')
      return {
        ...actual,
        homedir: () => tempHome,
      }
    })
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof NodeOs>('node:os')
      return {
        ...actual,
        homedir: () => tempHome,
      }
    })
  })

  afterEach(async () => {
    vi.doUnmock('os')
    vi.doUnmock('node:os')
    await rm(tempHome, { recursive: true, force: true })
  })

  it('copies a source skill into the chosen agent so its files land in the agent dir', async () => {
    // Arrange
    const sourcePath = join(tempHome, '.agents', 'skills', 'task')
    await mkdir(sourcePath, { recursive: true })
    await writeFile(
      join(sourcePath, 'SKILL.md'),
      '---\nname: task\ndescription: Task\n---\n',
    )
    await writeFile(join(sourcePath, 'notes.md'), 'copied payload')

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const copyToAgentsHandler = getRegisteredHandler('skills:copyToAgents')

    // Act
    const result = (await copyToAgentsHandler(
      {},
      {
        skillName: 'task',
        sourcePath,
        targetAgentIds: ['cursor'],
      },
    )) as {
      success: boolean
      copied: number
      failures: unknown[]
    }

    // Assert
    expect(result).toEqual({
      success: true,
      copied: 1,
      failures: [],
    })

    const copiedSkillPath = join(tempHome, '.cursor', 'skills', 'task')
    await expect(
      readFile(join(copiedSkillPath, 'SKILL.md'), 'utf-8'),
    ).resolves.toContain('name: task')
    await expect(
      readFile(join(copiedSkillPath, 'notes.md'), 'utf-8'),
    ).resolves.toBe('copied payload')
  })

  it('keeps nested symlinks as symlinks when copying a source skill into an agent', async () => {
    // Arrange
    const sourcePath = join(tempHome, '.agents', 'skills', 'task')
    await mkdir(join(sourcePath, 'docs'), { recursive: true })
    await writeFile(
      join(sourcePath, 'docs', 'guide.md'),
      'nested guide',
      'utf-8',
    )
    await symlink('./docs/guide.md', join(sourcePath, 'linked-guide.md'))

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const copyToAgentsHandler = getRegisteredHandler('skills:copyToAgents')

    // Act
    const result = (await copyToAgentsHandler(
      {},
      {
        skillName: 'task',
        sourcePath,
        targetAgentIds: ['cursor'],
      },
    )) as {
      success: boolean
      copied: number
      failures: unknown[]
    }

    // Assert
    expect(result).toEqual({
      success: true,
      copied: 1,
      failures: [],
    })

    const copiedLinkPath = join(
      tempHome,
      '.cursor',
      'skills',
      'task',
      'linked-guide.md',
    )
    const copiedLinkStats = await lstat(copiedLinkPath)
    expect(copiedLinkStats.isSymbolicLink()).toBe(true)
    await expect(readlink(copiedLinkPath)).resolves.toBe('./docs/guide.md')
    await expect(
      readFile(
        join(tempHome, '.cursor', 'skills', 'task', 'docs', 'guide.md'),
        'utf-8',
      ),
    ).resolves.toBe('nested guide')
  })

  it('copies a Devin symlink under symlinked .config using its physical relative target', async () => {
    // Arrange
    const skillName = 'devin-copy'
    const targetPath = join(tempHome, '.agents', 'skills', skillName)
    const physicalConfigDir = join(tempHome, 'dotfiles', '.config')
    const physicalDevinSkillsDir = join(physicalConfigDir, 'devin', 'skills')
    const logicalConfigDir = join(tempHome, '.config')
    const sourcePath = join(logicalConfigDir, 'devin', 'skills', skillName)
    const rawTarget = relative(physicalDevinSkillsDir, targetPath)
    await mkdir(targetPath, { recursive: true })
    await writeFile(join(targetPath, 'SKILL.md'), '# Devin copy\n')
    await mkdir(physicalDevinSkillsDir, { recursive: true })
    await symlink(physicalConfigDir, logicalConfigDir)
    await symlink(rawTarget, sourcePath)
    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()
    const copyToAgentsHandler = getRegisteredHandler('skills:copyToAgents')

    // Act
    const result = (await copyToAgentsHandler(
      {},
      {
        skillName,
        sourcePath,
        targetAgentIds: ['cursor'],
      },
    )) as {
      success: boolean
      copied: number
      failures: unknown[]
    }

    // Assert
    expect(result).toEqual({
      success: true,
      copied: 1,
      failures: [],
    })
    const copiedLinkPath = join(tempHome, '.cursor', 'skills', skillName)
    expect((await lstat(copiedLinkPath)).isSymbolicLink()).toBe(true)
    await expect(readlink(copiedLinkPath)).resolves.toBe(
      await realpath(targetPath),
    )
  })
})
