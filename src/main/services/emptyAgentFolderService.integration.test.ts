import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import type * as NodeFs from 'node:fs/promises'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { filesystemIdentityFromStats } from './filesystemIdentity'

const trashItemMock = vi.fn()
let afterStage: ((stagedPath: string) => Promise<void>) | undefined
let tempHome = ''

vi.mock('electron', () => ({ shell: { trashItem: trashItemMock } }))

beforeEach(async () => {
  vi.resetModules()
  trashItemMock.mockReset().mockResolvedValue(undefined)
  afterStage = undefined
  tempHome = await realpath(
    await mkdtemp(join(tmpdir(), 'empty-agent-folders-')),
  )
  vi.doMock('os', async () => ({
    ...(await vi.importActual<typeof NodeOs>('os')),
    homedir: () => tempHome,
  }))
  vi.doMock('node:os', async () => ({
    ...(await vi.importActual<typeof NodeOs>('node:os')),
    homedir: () => tempHome,
  }))
  vi.doMock('node:fs/promises', async () => ({
    ...(await vi.importActual<typeof NodeFs>('node:fs/promises')),
    rename: async (from: string, to: string) => {
      await rename(from, to)
      // Inject a concurrent write only after quarantine, before the final emptiness check.
      if (to.includes('.cleanup-')) await afterStage?.(to)
    },
  }))
})

afterEach(async () => {
  vi.doUnmock('os')
  vi.doUnmock('node:os')
  vi.doUnmock('node:fs/promises')
  await rm(tempHome, { recursive: true, force: true })
})

/**
 * Stages an empty dedicated parent when a deletion test needs a real reviewed directory.
 * @returns The Cline agent's confirmed path and identity for deletion IPC.
 * @example const options = await reviewEmptyClineFolder()
 */
async function reviewEmptyClineFolder() {
  const path = join(tempHome, '.cline')
  await mkdir(path)
  return {
    agentId: 'cline' as const,
    path,
    filesystemIdentity: filesystemIdentityFromStats(await lstat(path)),
  }
}

describe('not-installed agent empty folder cleanup', () => {
  it('offers only a real empty parent in the scanned not-installed agents', async () => {
    // Arrange
    const options = await reviewEmptyClineFolder()
    await mkdir(join(tempHome, '.warp'))
    await writeFile(join(tempHome, '.warp', '.settings.json'), '{}')
    const { scanAgents } = await import('./agentScanner')

    // Act
    const agents = await scanAgents()

    // Assert
    expect(agents.find((agent) => agent.id === 'cline')).toMatchObject({
      exists: false,
      emptyParentFolder: {
        path: join(tempHome, '.cline'),
        filesystemIdentity: options.filesystemIdentity,
      },
    })
    expect(
      agents.find((agent) => agent.id === 'warp')?.emptyParentFolder,
    ).toBeUndefined()
  })

  it('moves a reviewed empty parent to Trash without touching another agent', async () => {
    // Arrange
    const options = await reviewEmptyClineFolder()
    await mkdir(join(tempHome, '.warp', 'skills'), { recursive: true })
    await writeFile(join(tempHome, '.warp', 'settings.json'), 'keep')
    const { removeEmptyAgentFolder } = await import('./emptyAgentFolderService')

    // Act
    const result = await removeEmptyAgentFolder(options)

    // Assert
    expect(result).toEqual({ success: true, deleted: true })
    await expect(lstat(options.path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(trashItemMock).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/\.cline\.cleanup-/),
    )
    expect(await readdir(trashItemMock.mock.calls[0][0])).toEqual([])
    expect(
      await readFile(join(tempHome, '.warp', 'settings.json'), 'utf8'),
    ).toBe('keep')
  })

  it.each(['settings.json', '.DS_Store', 'skills'])(
    'keeps the parent when %s appears after review',
    async (entryName) => {
      // Arrange
      const options = await reviewEmptyClineFolder()
      if (entryName === 'skills') await mkdir(join(options.path, entryName))
      else await writeFile(join(options.path, entryName), 'keep')
      const { removeEmptyAgentFolder } =
        await import('./emptyAgentFolderService')

      // Act
      const result = await removeEmptyAgentFolder(options)

      // Assert
      expect(result).toEqual({
        success: false,
        error:
          'Agent folder is no longer empty or changed since review. Rescan before deleting.',
      })
      expect(await readdir(options.path)).toEqual([entryName])
      expect(trashItemMock).not.toHaveBeenCalled()
    },
  )

  it('rejects a different empty directory substituted after review', async () => {
    // Arrange
    const options = await reviewEmptyClineFolder()
    await rename(options.path, `${options.path}.original`)
    await mkdir(options.path)
    const { removeEmptyAgentFolder } = await import('./emptyAgentFolderService')

    // Act
    const result = await removeEmptyAgentFolder(options)

    // Assert
    expect(result.success).toBe(false)
    expect((await lstat(options.path)).isDirectory()).toBe(true)
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('restores a folder if a file arrives during quarantine', async () => {
    // Arrange
    const options = await reviewEmptyClineFolder()
    afterStage = async (path) => {
      await writeFile(join(path, 'history.json'), 'keep history')
    }
    const { removeEmptyAgentFolder } = await import('./emptyAgentFolderService')

    // Act
    const result = await removeEmptyAgentFolder(options)

    // Assert
    expect(result).toEqual({
      success: false,
      error: 'Agent folder is no longer empty or changed during deletion.',
    })
    expect(await readFile(join(options.path, 'history.json'), 'utf8')).toBe(
      'keep history',
    )
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('restores the empty folder when OS Trash rejects the move', async () => {
    // Arrange
    const options = await reviewEmptyClineFolder()
    trashItemMock.mockRejectedValue(new Error('Trash is unavailable'))
    const { removeEmptyAgentFolder } = await import('./emptyAgentFolderService')

    // Act
    const result = await removeEmptyAgentFolder(options)

    // Assert
    expect(result).toEqual({ success: false, error: 'Trash is unavailable' })
    expect(await readdir(options.path)).toEqual([])
  })

  it('does not overwrite a recreated folder when a failed move needs restoring', async () => {
    // Arrange
    const options = await reviewEmptyClineFolder()
    trashItemMock.mockImplementation(async () => {
      await mkdir(options.path)
      await writeFile(join(options.path, 'settings.json'), 'new settings')
      throw new Error('Trash is unavailable')
    })
    const { removeEmptyAgentFolder } = await import('./emptyAgentFolderService')

    // Act
    const result = await removeEmptyAgentFolder(options)

    // Assert
    expect(result).toEqual({
      success: false,
      error: `Trash is unavailable Folder kept at ${trashItemMock.mock.calls[0][0]}.`,
    })
    expect(await readFile(join(options.path, 'settings.json'), 'utf8')).toBe(
      'new settings',
    )
  })

  it('does not count a folder already removed after review as deleted', async () => {
    // Arrange
    const options = await reviewEmptyClineFolder()
    await rm(options.path, { recursive: true })
    const { removeEmptyAgentFolder } = await import('./emptyAgentFolderService')

    // Act
    const result = await removeEmptyAgentFolder(options)

    // Assert
    expect(result).toEqual({ success: true, deleted: false })
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('rejects an arbitrary renderer-provided parent path', async () => {
    // Arrange
    const options = await reviewEmptyClineFolder()
    const { removeEmptyAgentFolder } = await import('./emptyAgentFolderService')

    // Act
    const result = await removeEmptyAgentFolder({ ...options, path: tempHome })

    // Assert
    expect(result).toEqual({
      success: false,
      error: 'Agent folder does not match the reviewed path.',
    })
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('excludes empty shared roots and aliases from cleanup', async () => {
    // Arrange
    await mkdir(join(tempHome, '.config', 'agents'), { recursive: true })
    await mkdir(join(tempHome, '.agents'))
    await mkdir(join(tempHome, 'external'))
    await symlink(join(tempHome, 'external'), join(tempHome, '.cline'))
    const { scanAgents } = await import('./agentScanner')

    // Act
    const agents = await scanAgents()

    // Assert
    expect(
      agents.find((agent) => agent.id === 'amp')?.emptyParentFolder,
    ).toBeUndefined()
    expect(
      agents.find((agent) => agent.id === 'replit')?.emptyParentFolder,
    ).toBeUndefined()
    expect(
      agents.find((agent) => agent.id === 'cline')?.emptyParentFolder,
    ).toBeUndefined()
    expect(trashItemMock).not.toHaveBeenCalled()
  })

  it('keeps an empty agent folder beneath a symlinked config ancestor', async () => {
    // Arrange
    const externalConfig = join(tempHome, 'external-config')
    const externalAgentFolder = join(externalConfig, 'opencode')
    await mkdir(externalAgentFolder, { recursive: true })
    await symlink(externalConfig, join(tempHome, '.config'))
    const { scanAgents } = await import('./agentScanner')
    const { removeEmptyAgentFolder } = await import('./emptyAgentFolderService')

    // Act
    const agents = await scanAgents()
    const result = await removeEmptyAgentFolder({
      agentId: 'opencode',
      path: join(tempHome, '.config', 'opencode'),
      filesystemIdentity: filesystemIdentityFromStats(
        await lstat(externalAgentFolder),
      ),
    })

    // Assert
    expect(agents.find((agent) => agent.id === 'opencode')).toMatchObject({
      exists: false,
      emptyParentFolder: undefined,
    })
    expect(result).toEqual({
      success: false,
      error:
        'Agent folder is no longer empty or changed since review. Rescan before deleting.',
    })
    expect(await readdir(externalAgentFolder)).toEqual([])
    expect(trashItemMock).not.toHaveBeenCalled()
  })
})
