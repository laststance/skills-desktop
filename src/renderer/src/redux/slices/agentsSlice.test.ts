import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Agent } from '@/shared/types'

const mockGetAll = vi.fn()
const mockRemoveAllFromAgent = vi.fn()

const directoryIdentity = {
  kind: 'directory' as const,
  dev: 1,
  ino: 2,
  size: 96,
  ctimeMs: 3,
  mtimeMs: 4,
}

vi.stubGlobal('window', {
  electron: {
    agents: { getAll: mockGetAll },
    skills: { removeAllFromAgent: mockRemoveAllFromAgent },
  },
})

async function createTestStore() {
  const { default: agentsReducer } = await import('./agentsSlice')
  return configureStore({ reducer: { agents: agentsReducer } })
}

const sampleAgent: Agent = {
  id: 'claude-code' as Agent['id'],
  name: 'Claude Code' as Agent['name'],
  path: '/home/user/.claude/skills',
  exists: true,
  skillCount: 3,
  localSkillCount: 0,
  filesystemIdentity: directoryIdentity,
}

describe('agentsSlice', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('starts with no agents loaded and nothing pending deletion', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const state = store.getState().agents

    // Assert
    expect(state.items).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.agentToDelete).toBeNull()
    expect(state.deleting).toBe(false)
  })

  it('arms the delete confirmation for an agent and disarms it on cancel', async () => {
    // Arrange
    const { setAgentToDelete } = await import('./agentsSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(setAgentToDelete(sampleAgent))

    // Assert
    expect(store.getState().agents.agentToDelete).toEqual(sampleAgent)

    // Act
    store.dispatch(setAgentToDelete(null))

    // Assert
    expect(store.getState().agents.agentToDelete).toBeNull()
  })

  // --- fetchAgents thunk ---
  it('shows a loading state while the agent scan is in flight', async () => {
    // Arrange
    let resolve!: (value: Agent[]) => void
    mockGetAll.mockReturnValue(
      new Promise<Agent[]>((r) => {
        resolve = r
      }),
    )
    const store = await createTestStore()
    const { fetchAgents } = await import('./agentsSlice')

    // Act
    const promise = store.dispatch(fetchAgents())

    // Assert
    expect(store.getState().agents.loading).toBe(true)
    expect(store.getState().agents.error).toBeNull()

    resolve([sampleAgent])
    await promise
  })

  it('lists the scanned agents and clears loading once the scan finishes', async () => {
    // Arrange
    mockGetAll.mockResolvedValue([sampleAgent])
    const store = await createTestStore()
    const { fetchAgents } = await import('./agentsSlice')

    // Act
    await store.dispatch(fetchAgents())

    // Assert
    const state = store.getState().agents
    expect(state.items).toHaveLength(1)
    expect(state.items[0].name).toBe('Claude Code')
    expect(state.loading).toBe(false)
  })

  it('surfaces the failure message when the agent scan throws', async () => {
    // Arrange
    mockGetAll.mockRejectedValue(new Error('Permission denied'))
    const store = await createTestStore()
    const { fetchAgents } = await import('./agentsSlice')

    // Act
    await store.dispatch(fetchAgents())

    // Assert
    const state = store.getState().agents
    expect(state.loading).toBe(false)
    expect(state.error).toBe('Permission denied')
  })

  // --- removeAllSymlinksFromAgent thunk ---
  it('clears the pending agent and forwards the reviewed identity after a successful removal', async () => {
    // Arrange
    mockRemoveAllFromAgent.mockResolvedValue({
      success: true,
      removedCount: 5,
    })
    const store = await createTestStore()
    const { setAgentToDelete, removeAllSymlinksFromAgent } =
      await import('./agentsSlice')
    store.dispatch(setAgentToDelete(sampleAgent))

    // Act
    await store.dispatch(removeAllSymlinksFromAgent(sampleAgent))

    // Assert
    expect(store.getState().agents.agentToDelete).toBeNull()
    expect(store.getState().agents.deleting).toBe(false)
    expect(mockRemoveAllFromAgent).toHaveBeenCalledWith({
      agentId: 'claude-code',
      agentPath: '/home/user/.claude/skills',
      filesystemIdentity: directoryIdentity,
    })
  })

  it('refuses to delete and asks for a rescan when the reviewed agent identity is missing', async () => {
    // Arrange
    const staleAgent: Agent = { ...sampleAgent, filesystemIdentity: undefined }
    const store = await createTestStore()
    const { removeAllSymlinksFromAgent } = await import('./agentsSlice')

    // Act
    await store.dispatch(removeAllSymlinksFromAgent(staleAgent))

    // Assert
    expect(store.getState().agents.deleting).toBe(false)
    expect(store.getState().agents.error).toBe(
      'Agent skills folder changed since review. Rescan before deleting.',
    )
    expect(mockRemoveAllFromAgent).not.toHaveBeenCalled()
  })

  it('shows a deleting state while the symlink removal is in flight', async () => {
    // Arrange
    let resolve!: (value: { success: boolean; removedCount: number }) => void
    mockRemoveAllFromAgent.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    const store = await createTestStore()
    const { removeAllSymlinksFromAgent } = await import('./agentsSlice')

    // Act
    const promise = store.dispatch(removeAllSymlinksFromAgent(sampleAgent))

    // Assert
    expect(store.getState().agents.deleting).toBe(true)

    resolve({ success: true, removedCount: 3 })
    await promise
  })

  it('surfaces the backend error when symlink removal reports failure', async () => {
    // Arrange
    mockRemoveAllFromAgent.mockResolvedValue({
      success: false,
      error: 'Directory locked',
    })
    const store = await createTestStore()
    const { removeAllSymlinksFromAgent } = await import('./agentsSlice')

    // Act
    await store.dispatch(removeAllSymlinksFromAgent(sampleAgent))

    // Assert
    expect(store.getState().agents.deleting).toBe(false)
    expect(store.getState().agents.error).toBe('Directory locked')
  })

  it('surfaces the thrown error when symlink removal rejects', async () => {
    // Arrange
    mockRemoveAllFromAgent.mockRejectedValue(new Error('Unexpected error'))
    const store = await createTestStore()
    const { removeAllSymlinksFromAgent } = await import('./agentsSlice')

    // Act
    await store.dispatch(removeAllSymlinksFromAgent(sampleAgent))

    // Assert
    expect(store.getState().agents.deleting).toBe(false)
    expect(store.getState().agents.error).toBe('Unexpected error')
  })
})
