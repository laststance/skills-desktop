import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
      const actual = await vi.importActual<typeof import('os')>('os')
      return {
        ...actual,
        homedir: () => tempHome,
      }
    })
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os')
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

  it('accepts a source skill directory path and copies it into the target agent dir', async () => {
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
})
