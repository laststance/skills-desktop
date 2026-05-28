import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  AbsolutePath,
  AgentId,
  BulkUnlinkResult,
  SkillName,
} from '@/shared/types'

const handleMock = vi.fn()
const trashItemMock = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: unknown[]) => handleMock(...args),
  },
  shell: {
    trashItem: (...args: unknown[]) => trashItemMock(...args),
  },
}))

/**
 * Return the registered unlink IPC handler from the mocked Electron registry.
 * @param channel - IPC channel name to locate.
 * @returns Handler registered by registerSkillsHandlers().
 * @example getRegisteredHandler('skills:unlinkFromAgent')
 */
function getRegisteredHandler(channel: string): (
  event: unknown,
  arg: {
    skillName: string
    agentId: string
    linkPath: string
    confirmedLocalDirectoryDelete?: boolean
  },
) => Promise<{ success: boolean; error?: string }> {
  const registration = handleMock.mock.calls.find(([name]) => name === channel)
  if (!registration) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return registration[1] as (
    event: unknown,
    arg: {
      skillName: string
      agentId: string
      linkPath: string
      confirmedLocalDirectoryDelete?: boolean
    },
  ) => Promise<{ success: boolean; error?: string }>
}

/**
 * Return a typed IPC handler from the mocked Electron registry.
 * @param channel - IPC channel name to locate.
 * @returns Handler registered by registerSkillsHandlers().
 * @example getRegisteredInvokeHandler('skills:unlinkManyFromAgent')
 */
function getRegisteredInvokeHandler<TArg, TResult>(
  channel: string,
): (event: unknown, arg: TArg) => Promise<TResult> {
  const registration = handleMock.mock.calls.find(([name]) => name === channel)
  if (!registration) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return registration[1] as (event: unknown, arg: TArg) => Promise<TResult>
}

describe('skills:unlinkFromAgent handler', () => {
  let tempHome = ''

  beforeEach(async () => {
    vi.resetModules()
    handleMock.mockReset()
    trashItemMock.mockReset()
    trashItemMock.mockResolvedValue(undefined)
    tempHome = await mkdtemp(join(tmpdir(), 'skills-desktop-unlink-'))
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

  it('rejects a source path when the selected agent is Cursor', async () => {
    // Arrange
    const skillName = 'unlink-source-path-guard-fixture'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `name: ${skillName}\n`)

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredHandler('skills:unlinkFromAgent')
    const result = await handler(
      {},
      {
        skillName,
        agentId: 'cursor',
        linkPath: sourcePath,
      },
    )

    // Assert
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/does not match the selected agent slot/i)
    await expect(lstat(sourcePath)).resolves.toBeDefined()
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('rejects another agent slot when the selected agent is Cursor', async () => {
    // Arrange
    const skillName = 'unlink-other-agent-path-guard-fixture'
    const sourcePath = join(tempHome, '.agents', 'skills', skillName)
    const cursorLinkPath = join(tempHome, '.cursor', 'skills', skillName)
    const claudeLinkPath = join(tempHome, '.claude', 'skills', skillName)
    await mkdir(sourcePath, { recursive: true })
    await mkdir(join(tempHome, '.cursor', 'skills'), { recursive: true })
    await mkdir(join(tempHome, '.claude', 'skills'), { recursive: true })
    await symlink(sourcePath, cursorLinkPath)
    await symlink(sourcePath, claudeLinkPath)

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredHandler('skills:unlinkFromAgent')
    const result = await handler(
      {},
      {
        skillName,
        agentId: 'cursor',
        linkPath: claudeLinkPath,
      },
    )

    // Assert
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/does not match the selected agent slot/i)
    await expect(lstat(cursorLinkPath)).resolves.toBeDefined()
    await expect(lstat(claudeLinkPath)).resolves.toBeDefined()
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('unlinks the reviewed slot when metadata name differs from the folder basename', async () => {
    // Arrange
    const metadataName = 'metadata-title'
    const slotName = 'folder-basename'
    const sourcePath = join(tempHome, '.agents', 'skills', slotName)
    const cursorLinkPath = join(tempHome, '.cursor', 'skills', slotName)
    await mkdir(sourcePath, { recursive: true })
    await mkdir(join(tempHome, '.cursor', 'skills'), { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `name: ${metadataName}\n`)
    await symlink(sourcePath, cursorLinkPath)

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredHandler('skills:unlinkFromAgent')
    const result = await handler(
      {},
      {
        skillName: metadataName,
        agentId: 'cursor',
        linkPath: cursorLinkPath,
      },
    )

    // Assert
    expect(result.success).toBe(true)
    await expect(lstat(cursorLinkPath)).rejects.toThrow(/ENOENT/)
    await expect(lstat(sourcePath)).resolves.toBeDefined()
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('bulk unlink removes reviewed slot when metadata name differs from folder basename', async () => {
    // Arrange
    const metadataName = 'metadata-title-bulk' as SkillName
    const slotName = 'folder-basename-bulk'
    const sourcePath = join(tempHome, '.agents', 'skills', slotName)
    const cursorSkillsDir = join(tempHome, '.cursor', 'skills')
    const cursorLinkPath = join(cursorSkillsDir, slotName) as AbsolutePath
    const decoyLinkPath = join(cursorSkillsDir, metadataName)
    await mkdir(sourcePath, { recursive: true })
    await mkdir(cursorSkillsDir, { recursive: true })
    await writeFile(join(sourcePath, 'SKILL.md'), `name: ${metadataName}\n`)
    await symlink(sourcePath, cursorLinkPath)
    await symlink(sourcePath, decoyLinkPath)

    const { registerSkillsHandlers } = await import('./skills')
    registerSkillsHandlers()

    // Act
    const handler = getRegisteredInvokeHandler<
      {
        agentId: AgentId
        items: Array<{ skillName: SkillName; linkPath: AbsolutePath }>
      },
      BulkUnlinkResult
    >('skills:unlinkManyFromAgent')
    const result = await handler(
      {},
      {
        agentId: 'cursor' as AgentId,
        items: [{ skillName: metadataName, linkPath: cursorLinkPath }],
      },
    )

    // Assert
    expect(result.items).toEqual([
      { skillName: metadataName, outcome: 'unlinked' },
    ])
    await expect(lstat(cursorLinkPath)).rejects.toThrow(/ENOENT/)
    await expect(lstat(decoyLinkPath)).resolves.toBeDefined()
    await expect(lstat(sourcePath)).resolves.toBeDefined()
    expect(trashItemMock).not.toHaveBeenCalled()
  })
})
