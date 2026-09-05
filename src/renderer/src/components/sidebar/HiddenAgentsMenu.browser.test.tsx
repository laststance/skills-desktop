import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type { Agent, FilesystemEntryIdentity, Skill } from '@/shared/types'

const mockRemoveAllFromAgent = vi.fn()
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

beforeEach(() => {
  vi.resetAllMocks()
  mockRemoveAllFromAgent.mockResolvedValue({ success: true, removedCount: 2 })
  mockSkillsGetAll.mockResolvedValue([])
  mockAgentsGetAll.mockResolvedValue([])
  mockSourceGetStats.mockResolvedValue({})
  // Keep the real Redux mutation and refresh behavior while replacing Electron IPC.
  vi.stubGlobal('electron', {
    skills: {
      removeAllFromAgent: mockRemoveAllFromAgent,
      getAll: mockSkillsGetAll,
    },
    agents: { getAll: mockAgentsGetAll },
    source: { getStats: mockSourceGetStats },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Mount the hidden-agent action against real reducers for browser interaction tests.
 * @param agents - Hidden installed agents offered by the sidebar.
 * @returns Rendered menu and store for protection or visibility changes.
 * @example await renderHiddenMenu([cline, warp])
 */
async function renderHiddenMenu(agents: Agent[] = [cline, warp]) {
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: protectReducer } =
    await import('@/renderer/src/redux/slices/protectSlice')
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  const { HiddenAgentsMenu } = await import('./HiddenAgentsMenu')
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
        hiddenAgentIds: agents.map((agent) => agent.id),
      },
    },
  })
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <HiddenAgentsMenu agents={agents} />
      </TooltipProvider>
    </Provider>,
  )
  await screen.getByRole('button', { name: 'Hidden agent actions' }).click()
  await screen
    .getByRole('menuitem', { name: 'Delete skills folders...' })
    .click()
  return { screen, store }
}

describe('Hidden agent folder deletion', () => {
  it('reviews the hidden folder paths and cancels without deleting anything', async () => {
    // Arrange
    const { screen } = await renderHiddenMenu()
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
    const { screen } = await renderHiddenMenu([
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
    const { screen, store } = await renderHiddenMenu([cline])
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

  it('continues after one hidden folder fails and reports the failed agent', async () => {
    // Arrange
    mockRemoveAllFromAgent
      .mockResolvedValueOnce({ success: false, error: 'Permission denied' })
      .mockResolvedValueOnce({ success: true, removedCount: 2 })
    const { screen } = await renderHiddenMenu()

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
    const { screen, store } = await renderHiddenMenu()
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
    const { screen, store } = await renderHiddenMenu()
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
