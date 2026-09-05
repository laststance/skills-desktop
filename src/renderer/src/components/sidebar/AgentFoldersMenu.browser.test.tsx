import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import type { AgentFolderGroup } from '@/renderer/src/redux/slices/uiSlice'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type { Agent, FilesystemEntryIdentity, Skill } from '@/shared/types'

const mockRemoveAllFromAgent = vi.fn()
const mockRemoveEmptyFolder = vi.fn()
const mockSkillsGetAll = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockSourceGetStats = vi.fn()
const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const directoryIdentity: FilesystemEntryIdentity = {
  kind: 'directory',
  dev: 1,
  ino: 2,
  size: 96,
  ctimeMs: 3,
  mtimeMs: 4,
}

const cline: Agent = {
  id: 'cline',
  name: 'Cline',
  path: '/Users/test/.cline/skills',
  exists: true,
  skillCount: 2,
  localSkillCount: 0,
  filesystemIdentity: directoryIdentity,
}

const warp: Agent = {
  ...cline,
  id: 'warp',
  name: 'Warp',
  path: '/Users/test/.warp/skills',
}

const unusedCline: Agent = {
  ...cline,
  exists: false,
  skillCount: 0,
  filesystemIdentity: undefined,
  emptyParentFolder: {
    path: '/Users/test/.cline',
    filesystemIdentity: directoryIdentity,
  },
}

const unusedWarp: Agent = {
  ...warp,
  exists: false,
  skillCount: 0,
  filesystemIdentity: undefined,
  emptyParentFolder: {
    path: '/Users/test/.warp',
    filesystemIdentity: directoryIdentity,
  },
}

beforeEach(() => {
  vi.resetAllMocks()
  mockRemoveAllFromAgent.mockResolvedValue({ success: true, removedCount: 2 })
  mockRemoveEmptyFolder.mockResolvedValue({ success: true, deleted: true })
  mockSkillsGetAll.mockResolvedValue([])
  mockAgentsGetAll.mockResolvedValue([])
  mockSourceGetStats.mockResolvedValue({})
  // Keep the real Redux mutation and refresh behavior while replacing Electron IPC.
  vi.stubGlobal('electron', {
    skills: {
      removeAllFromAgent: mockRemoveAllFromAgent,
      getAll: mockSkillsGetAll,
    },
    agents: {
      getAll: mockAgentsGetAll,
      removeEmptyFolder: mockRemoveEmptyFolder,
    },
    source: { getStats: mockSourceGetStats },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Mount both sidebar menu instances against real reducers for browser interaction tests.
 * @param agents - Agents offered by the selected sidebar group.
 * @param group - Menu under test; the sibling stays mounted to catch duplicate dialogs.
 * @param openReview - Whether to select the deletion item after opening the menu.
 * @returns Rendered menu and store for protection or visibility changes.
 * @example await renderAgentFolderMenu([cline, warp])
 */
async function renderAgentFolderMenu(
  agents: Agent[] = [cline, warp],
  group: AgentFolderGroup = 'hidden',
  openReview = true,
) {
  const { default: agentsReducer, fetchAgents } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: protectReducer } =
    await import('@/renderer/src/redux/slices/protectSlice')
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  const { AgentFoldersMenu: AgentFoldersMenu } =
    await import('./AgentFoldersMenu')
  const store = configureStore({
    reducer: {
      agents: agentsReducer,
      skills: skillsReducer,
      protect: protectReducer,
      ui: uiReducer,
      settings: settingsReducer,
    },
    preloadedState: {
      settings: {
        ...DEFAULT_SETTINGS,
        hiddenAgentIds:
          group === 'hidden' ? agents.map((agent) => agent.id) : [],
      },
    },
  })
  store.dispatch(fetchAgents.fulfilled(agents, 'initial-scan'))
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <AgentFoldersMenu agents={agents} group={group} />
        <AgentFoldersMenu
          agents={[]}
          group={group === 'hidden' ? 'unused' : 'hidden'}
        />
      </TooltipProvider>
    </Provider>,
  )
  await screen
    .getByRole('button', {
      name:
        group === 'hidden'
          ? 'Hidden agent actions'
          : 'Not installed agent actions',
    })
    .click()
  if (openReview) {
    await screen
      .getByRole('menuitem', {
        name:
          group === 'hidden'
            ? 'Delete skills folders...'
            : 'Delete empty agent folders...',
      })
      .click()
  }
  return { screen, store }
}

describe('Hidden agent folder deletion', () => {
  it('reviews the hidden folder paths and cancels without deleting anything', async () => {
    // Arrange
    const { screen } = await renderAgentFolderMenu()
    const dialog = screen.getByRole('dialog', {
      name: 'Delete hidden agents’ skills folders?',
    })
    await expect.element(dialog).toBeVisible()
    await expect
      .element(dialog.getByText('Cline', { exact: true }))
      .toBeVisible()
    await expect
      .element(dialog.getByText('Warp', { exact: true }))
      .toBeVisible()
    await expect
      .element(dialog.getByText(cline.path, { exact: true }))
      .toBeVisible()
    await expect
      .element(dialog.getByText(warp.path, { exact: true }))
      .toBeVisible()

    // Act
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

    // Assert
    await expect.element(dialog).not.toBeInTheDocument()
    expect(mockRemoveAllFromAgent).not.toHaveBeenCalled()
    expect(mockSkillsGetAll).not.toHaveBeenCalled()
    await expect
      .element(screen.getByRole('button', { name: 'Hidden agent actions' }))
      .toHaveFocus()

    // Keyboard activation and Escape must preserve the same cancellation path.
    await userEvent.keyboard('{Enter}')
    await expect
      .element(
        screen.getByRole('menuitem', { name: 'Delete skills folders...' }),
      )
      .toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect.element(dialog).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(dialog).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Hidden agent actions' }))
      .toHaveFocus()
    expect(mockRemoveAllFromAgent).not.toHaveBeenCalled()
  })

  it('deletes eligible hidden folders while excluding shared and unreviewed paths', async () => {
    // Arrange
    const sharedAgent: Agent = {
      ...cline,
      id: 'amp',
      name: 'Amp',
      path: '/Users/test/.config/agents/skills',
    }
    const aliasedAgent: Agent = {
      ...warp,
      filesystemIdentity: { ...directoryIdentity, kind: 'symlink' },
    }
    const { screen } = await renderAgentFolderMenu([
      cline,
      sharedAgent,
      aliasedAgent,
    ])

    // Act
    await screen
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect.poll(() => mockToastSuccess.mock.calls.length).toBe(1)
    expect(mockRemoveAllFromAgent).toHaveBeenCalledExactlyOnceWith({
      agentId: 'cline',
      agentPath: '/Users/test/.cline/skills',
      filesystemIdentity: directoryIdentity,
      protectedSkillPaths: [],
    })
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Deleted skills from 1 hidden agent',
      { description: 'Removed 2 items; kept 0 protected' },
    )
    expect(mockSkillsGetAll).toHaveBeenCalledTimes(1)
    expect(mockAgentsGetAll).toHaveBeenCalledTimes(1)
    expect(mockSourceGetStats).toHaveBeenCalledTimes(1)
  })

  it('keeps protected skill slots when deleting the remaining hidden-agent skills', async () => {
    // Arrange
    const { screen, store } = await renderAgentFolderMenu([cline])
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')
    const protectedSkill: Skill = {
      name: 'protected-task',
      description: 'Protected source skill',
      path: '/Users/test/.agents/skills/protected-task',
      symlinkCount: 1,
      symlinks: [
        {
          agentId: 'cline',
          agentName: 'Cline',
          status: 'valid',
          targetPath: '/Users/test/.agents/skills/protected-task',
          linkPath: '/Users/test/.cline/skills/protected-slot',
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: false,
    }
    store.dispatch(fetchSkills.fulfilled([protectedSkill], 'protected-skills'))
    store.dispatch(addProtection('protected-task'))
    mockRemoveAllFromAgent.mockResolvedValue({
      success: true,
      removedCount: 1,
      preservedCount: 1,
    })

    // Act
    await screen
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect.poll(() => mockToastSuccess.mock.calls.length).toBe(1)
    expect(mockRemoveAllFromAgent).toHaveBeenCalledExactlyOnceWith({
      agentId: 'cline',
      agentPath: '/Users/test/.cline/skills',
      filesystemIdentity: directoryIdentity,
      protectedSkillPaths: ['/Users/test/.cline/skills/protected-slot'],
    })
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Deleted skills from 1 hidden agent',
      { description: 'Removed 1 items; kept 1 protected' },
    )
  })

  it.each([
    {
      scenario: 'only protected skills remain',
      preservedCount: 1,
      expectedDescription: 'Removed 0 items; kept 1 protected',
    },
    {
      scenario: 'an empty skills folder is removed',
      preservedCount: 0,
      expectedDescription: 'Removed 0 items; kept 0 protected',
    },
  ])(
    'confirms completion without claiming skill deletion when $scenario',
    async ({ preservedCount, expectedDescription }) => {
      // Arrange
      mockRemoveAllFromAgent.mockResolvedValue({
        success: true,
        removedCount: 0,
        preservedCount,
      })
      const { screen } = await renderAgentFolderMenu([cline])

      // Act
      await screen
        .getByRole('button', { name: 'Delete folders', exact: true })
        .click()

      // Assert
      await expect.poll(() => mockToastSuccess.mock.calls.length).toBe(1)
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Hidden agent cleanup complete',
        {
          description: expectedDescription,
        },
      )
    },
  )

  it('continues after one hidden folder fails and reports the failed agent', async () => {
    // Arrange
    mockRemoveAllFromAgent
      .mockResolvedValueOnce({ success: false, error: 'Permission denied' })
      .mockResolvedValueOnce({ success: true, removedCount: 2 })
    const { screen } = await renderAgentFolderMenu()

    // Act
    await screen
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect.poll(() => mockToastError.mock.calls.length).toBe(1)
    expect(mockRemoveAllFromAgent).toHaveBeenNthCalledWith(2, {
      agentId: 'warp',
      agentPath: '/Users/test/.warp/skills',
      filesystemIdentity: directoryIdentity,
      protectedSkillPaths: [],
    })
    expect(mockToastError).toHaveBeenCalledWith(
      'Some skills folders could not be deleted',
      { description: 'Cline: Permission denied' },
    )
    expect(mockAgentsGetAll).toHaveBeenCalledTimes(1)
  })

  it('preserves an agent made visible after the deletion review was opened', async () => {
    // Arrange
    const { screen, store } = await renderAgentFolderMenu()
    const { setSettings } =
      await import('@/renderer/src/redux/slices/settingsSlice')
    store.dispatch(
      setSettings({ ...store.getState().settings, hiddenAgentIds: ['warp'] }),
    )

    // Act
    await screen
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect.poll(() => mockAgentsGetAll.mock.calls.length).toBe(1)
    expect(mockRemoveAllFromAgent).toHaveBeenCalledExactlyOnceWith({
      agentId: 'warp',
      agentPath: '/Users/test/.warp/skills',
      filesystemIdentity: directoryIdentity,
      protectedSkillPaths: [],
    })
  })

  it('skips an agent made visible while an earlier hidden folder is being deleted', async () => {
    // Arrange
    let finishFirstDeletion: (() => void) | undefined
    mockRemoveAllFromAgent.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          finishFirstDeletion = () =>
            resolve({ success: true, removedCount: 2 })
        }),
    )
    const { screen, store } = await renderAgentFolderMenu()
    const { setSettings } =
      await import('@/renderer/src/redux/slices/settingsSlice')

    // Act
    await screen
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()
    await expect.poll(() => mockRemoveAllFromAgent.mock.calls.length).toBe(1)
    store.dispatch(
      setSettings({ ...store.getState().settings, hiddenAgentIds: ['cline'] }),
    )
    if (!finishFirstDeletion)
      throw new Error('First folder deletion did not start')
    finishFirstDeletion()

    // Assert
    await expect.poll(() => mockToastError.mock.calls.length).toBe(1)
    expect(mockRemoveAllFromAgent).toHaveBeenCalledExactlyOnceWith({
      agentId: 'cline',
      agentPath: '/Users/test/.cline/skills',
      filesystemIdentity: directoryIdentity,
      protectedSkillPaths: [],
    })
    expect(mockToastError).toHaveBeenCalledWith(
      'Some skills folders could not be deleted',
      { description: 'Warp: no longer hidden; skipped' },
    )
    expect(mockAgentsGetAll).toHaveBeenCalledTimes(1)
  })
})

describe('Not-installed agent empty folder deletion', () => {
  it('reviews empty parent paths in one dialog and restores focus after cancellation', async () => {
    // Arrange
    const { screen } = await renderAgentFolderMenu(
      [unusedCline, unusedWarp],
      'unused',
    )
    const dialog = screen.getByRole('dialog', {
      name: 'Delete empty agent folders?',
    })

    // Act
    await expect.element(dialog).toBeVisible()
    await expect
      .element(dialog.getByText('/Users/test/.cline', { exact: true }))
      .toBeVisible()
    await expect
      .element(dialog.getByText('/Users/test/.warp', { exact: true }))
      .toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

    // Assert
    await expect.element(dialog).not.toBeInTheDocument()
    expect(mockRemoveEmptyFolder).not.toHaveBeenCalled()
    expect(mockRemoveAllFromAgent).not.toHaveBeenCalled()
    await expect
      .element(
        screen.getByRole('button', { name: 'Not installed agent actions' }),
      )
      .toHaveFocus()
  })

  it('deletes only reviewed empty parents and explains skipped nonempty folders', async () => {
    // Arrange
    const { screen } = await renderAgentFolderMenu(
      [unusedCline, { ...unusedWarp, emptyParentFolder: undefined }],
      'unused',
    )
    await expect
      .element(
        screen.getByText(
          '1 agent without an empty, separate folder will be skipped.',
        ),
      )
      .toBeVisible()

    // Act
    await screen
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect.poll(() => mockToastSuccess.mock.calls.length).toBe(1)
    expect(mockRemoveEmptyFolder).toHaveBeenCalledExactlyOnceWith({
      agentId: 'cline',
      path: '/Users/test/.cline',
      filesystemIdentity: directoryIdentity,
    })
    expect(mockRemoveAllFromAgent).not.toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Deleted 1 empty agent folder',
      {
        description:
          'Folders containing files, settings, history, or skills were kept.',
      },
    )
    expect(mockAgentsGetAll).toHaveBeenCalledTimes(1)
  })

  it('disables empty-folder cleanup when no not-installed agent has an empty parent', async () => {
    // Arrange
    const { screen } = await renderAgentFolderMenu(
      [{ ...unusedCline, emptyParentFolder: undefined }],
      'unused',
      false,
    )

    // Assert
    await expect
      .element(
        screen.getByRole('menuitem', { name: 'Delete empty agent folders...' }),
      )
      .toHaveAttribute('aria-disabled', 'true')
    expect(mockRemoveEmptyFolder).not.toHaveBeenCalled()
  })

  it('skips an agent whose skills are installed after the empty-folder review', async () => {
    // Arrange
    const { screen, store } = await renderAgentFolderMenu(
      [unusedCline, unusedWarp],
      'unused',
    )
    const { fetchAgents } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    store.dispatch(fetchAgents.fulfilled([cline, unusedWarp], 'new-scan'))

    // Act
    await screen
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect.poll(() => mockToastError.mock.calls.length).toBe(1)
    expect(mockRemoveEmptyFolder).toHaveBeenCalledExactlyOnceWith({
      agentId: 'warp',
      path: '/Users/test/.warp',
      filesystemIdentity: directoryIdentity,
    })
    expect(mockToastError).toHaveBeenCalledWith(
      'Some empty agent folders could not be deleted',
      {
        description: 'Cline: no longer eligible; skipped',
      },
    )
  })

  it('continues after an IPC rejection and reports only the folders actually deleted', async () => {
    // Arrange
    mockRemoveEmptyFolder.mockRejectedValueOnce(new Error('Permission denied'))
    const { screen } = await renderAgentFolderMenu(
      [unusedCline, unusedWarp],
      'unused',
    )

    // Act
    await screen
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect.poll(() => mockToastError.mock.calls.length).toBe(1)
    expect(mockRemoveEmptyFolder).toHaveBeenCalledTimes(2)
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Deleted 1 empty agent folder',
      {
        description:
          'Folders containing files, settings, history, or skills were kept.',
      },
    )
    expect(mockToastError).toHaveBeenCalledWith(
      'Some empty agent folders could not be deleted',
      {
        description: 'Cline: Permission denied',
      },
    )
  })

  it('does not claim deletion when the reviewed empty folder has already disappeared', async () => {
    // Arrange
    mockRemoveEmptyFolder.mockResolvedValueOnce({
      success: true,
      deleted: false,
    })
    const { screen } = await renderAgentFolderMenu([unusedCline], 'unused')

    // Act
    await screen
      .getByRole('button', { name: 'Delete folders', exact: true })
      .click()

    // Assert
    await expect.poll(() => mockToastSuccess.mock.calls.length).toBe(1)
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Deleted 0 empty agent folders',
      {
        description:
          'Folders containing files, settings, history, or skills were kept.',
      },
    )
  })
})
