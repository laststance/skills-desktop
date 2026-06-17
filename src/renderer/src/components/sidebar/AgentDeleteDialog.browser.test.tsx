import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

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

/**
 * Build a minimal Agent fixture queued for skills-folder deletion.
 * `filesystemIdentity` defaults present so the delete thunk reaches IPC; pass
 * `filesystemIdentity: undefined` to exercise the stale-scan guard rejection.
 * @param overrides - Partial Agent overrides.
 * @returns Complete Agent object.
 * @example makeAgent({ name: 'Cursor' as Agent['name'] })
 */
function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    path: '/Users/test/.claude/skills' as Agent['path'],
    exists: true,
    skillCount: 3,
    localSkillCount: 1,
    filesystemIdentity: directoryIdentity,
    ...overrides,
  }
}

beforeEach(() => {
  mockRemoveAllFromAgent.mockReset()
  mockSkillsGetAll.mockReset()
  mockAgentsGetAll.mockReset()
  mockSourceGetStats.mockReset()
  mockToastSuccess.mockReset()
  mockToastError.mockReset()

  // refreshAllData fan-out fetches — keep them resolved so the post-delete
  // refresh never rejects under the dialog.
  mockSkillsGetAll.mockResolvedValue([])
  mockAgentsGetAll.mockResolvedValue([])
  mockSourceGetStats.mockResolvedValue({})

  // Browser mode replaces Electron's preload bridge, so install the IPC
  // surface AgentDeleteDialog reaches through the agents thunks.
  vi.stubGlobal('electron', {
    skills: {
      removeAllFromAgent: mockRemoveAllFromAgent,
      getAll: mockSkillsGetAll,
    },
    agents: {
      getAll: mockAgentsGetAll,
    },
    source: {
      getStats: mockSourceGetStats,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Render AgentDeleteDialog against a real agents reducer, then optionally queue
 * an agent for deletion so the dialog opens (mirrors AgentItem's menu action).
 * @param options.agent - Agent to queue via setAgentToDelete (omit to leave closed).
 * @returns Render handle and Redux store.
 * @example const { screen, store } = await renderDeleteDialog({ agent: makeAgent() })
 */
async function renderDeleteDialog(options: { agent?: Agent } = {}) {
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: protectReducer } =
    await import('@/renderer/src/redux/slices/protectSlice')
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { setAgentToDelete } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { AgentDeleteDialog } = await import('./AgentDeleteDialog')

  const store = configureStore({
    reducer: {
      agents: agentsReducer,
      skills: skillsReducer,
      protect: protectReducer,
      ui: uiReducer,
    },
  })

  const screen = await render(
    <Provider store={store}>
      <AgentDeleteDialog />
    </Provider>,
  )

  if (options.agent) {
    store.dispatch(setAgentToDelete(options.agent))
  }

  return { screen, store }
}

describe('AgentDeleteDialog confirm action', () => {
  it('confirms with the agent name and removed-item count in the success toast', async () => {
    // Arrange
    mockRemoveAllFromAgent.mockResolvedValue({ success: true, removedCount: 5 })
    const agent = makeAgent({ name: 'Claude Code' as Agent['name'] })
    const { screen, store } = await renderDeleteDialog({ agent })
    await expect
      .element(screen.getByRole('dialog', { name: /Delete Skills Folder/i }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: /^Delete$/i }).click()

    // Assert
    await expect
      .poll(() => mockToastSuccess.mock.calls.length)
      .toBeGreaterThan(0)
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Deleted skills folder for Claude Code',
      { description: 'Removed 5 items' },
    )
    // fulfilled reducer clears the queued agent and refreshAllData re-fetches.
    await expect.poll(() => store.getState().agents.agentToDelete).toBeNull()
    await expect
      .poll(() => mockAgentsGetAll.mock.calls.length)
      .toBeGreaterThan(0)
  })

  it('sends protected agent slot paths so folder delete preserves them', async () => {
    // Arrange
    mockRemoveAllFromAgent.mockResolvedValue({
      success: true,
      removedCount: 1,
      preservedCount: 1,
    })
    const agent = makeAgent({ name: 'Claude Code' as Agent['name'] })
    const protectedSkill: Skill = {
      name: 'protected-task',
      description: 'Protected task',
      path: '/Users/test/.agents/skills/protected-task',
      symlinkCount: 1,
      symlinks: [
        {
          agentId: 'claude-code',
          agentName: 'Claude Code',
          status: 'valid',
          targetPath: '/Users/test/.agents/skills/protected-task',
          linkPath: '/Users/test/.claude/skills/folder-basename',
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: false,
    }
    const { screen, store } = await renderDeleteDialog({ agent })
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { addProtection } =
      await import('@/renderer/src/redux/slices/protectSlice')
    store.dispatch(fetchSkills.fulfilled([protectedSkill], 'skills-request'))
    store.dispatch(addProtection('protected-task'))

    // Act
    await screen.getByRole('button', { name: /^Delete$/i }).click()

    // Assert
    await expect
      .poll(() => mockRemoveAllFromAgent.mock.calls.length)
      .toBeGreaterThan(0)
    expect(mockRemoveAllFromAgent).toHaveBeenCalledWith({
      agentId: 'claude-code',
      agentPath: '/Users/test/.claude/skills',
      filesystemIdentity: directoryIdentity,
      protectedSkillPaths: ['/Users/test/.claude/skills/folder-basename'],
    })
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Deleted unprotected skills for Claude Code',
      { description: 'Removed 1 items; kept 1 protected' },
    )
  })

  it('surfaces the IPC failure reason in an error toast when deletion fails', async () => {
    // Arrange
    mockRemoveAllFromAgent.mockResolvedValue({
      success: false,
      error: 'EPERM: operation not permitted',
    })
    const agent = makeAgent()
    const { screen } = await renderDeleteDialog({ agent })
    await expect
      .element(screen.getByRole('dialog', { name: /Delete Skills Folder/i }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: /^Delete$/i }).click()

    // Assert
    await expect.poll(() => mockToastError.mock.calls.length).toBeGreaterThan(0)
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to delete skills folder',
      {
        description: 'EPERM: operation not permitted',
      },
    )
  })

  it('falls back to a generic error message when a stale-scan agent is rejected', async () => {
    // Arrange
    // A missing filesystemIdentity makes the thunk reject before reaching IPC;
    // the dialog must still surface a toast so the user is never left without
    // feedback after a failed delete.
    const agent = makeAgent({ filesystemIdentity: undefined })
    const { screen } = await renderDeleteDialog({ agent })
    await expect
      .element(screen.getByRole('dialog', { name: /Delete Skills Folder/i }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: /^Delete$/i }).click()

    // Assert
    await expect.poll(() => mockToastError.mock.calls.length).toBeGreaterThan(0)
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to delete skills folder',
      {
        description:
          'Agent skills folder changed since review. Rescan before deleting.',
      },
    )
    expect(mockRemoveAllFromAgent).not.toHaveBeenCalled()
  })
})

describe('AgentDeleteDialog cancel behavior', () => {
  it('clears the queued agent when cancelled while idle', async () => {
    // Arrange
    const agent = makeAgent()
    const { screen, store } = await renderDeleteDialog({ agent })
    await expect
      .element(screen.getByRole('dialog', { name: /Delete Skills Folder/i }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: /^Cancel$/i }).click()

    // Assert
    await expect.poll(() => store.getState().agents.agentToDelete).toBeNull()
    expect(mockRemoveAllFromAgent).not.toHaveBeenCalled()
  })

  it('refuses to dismiss via Escape while a deletion is already in flight', async () => {
    // Arrange
    // While deleting is true the dialog must refuse to close so the user cannot
    // abandon an in-progress destructive operation mid-delete.
    const agent = makeAgent()
    const { screen, store } = await renderDeleteDialog({ agent })
    const { removeAllSymlinksFromAgent } =
      await import('@/renderer/src/redux/slices/agentsSlice')
    // Drive the slice into the pending state without resolving the thunk so the
    // dialog renders in its loading guard.
    store.dispatch(removeAllSymlinksFromAgent.pending('req-id', agent))
    expect(store.getState().agents.deleting).toBe(true)
    const dialog = screen.getByRole('dialog', { name: /Delete Skills Folder/i })
    await expect.element(dialog).toBeInTheDocument()

    // Act
    // Escape still routes through onOpenChange even though Cancel is disabled;
    // handleClose's `if (!deleting)` guard must swallow it.
    dialog
      .element()
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )

    // Assert — the guard means a close attempt during deletion is a no-op;
    // the queued agent stays set and the dialog stays mounted.
    expect(store.getState().agents.agentToDelete).not.toBeNull()
    await expect.element(dialog).toBeInTheDocument()
  })
})
