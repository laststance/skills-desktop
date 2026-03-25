import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Agent } from '../../../../shared/types'

const mockGetAll = vi.fn()
const mockRemoveAllFromAgent = vi.fn()

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
}

describe('agentsSlice', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('has correct initial state', async () => {
    const store = await createTestStore()
    const state = store.getState().agents
    expect(state.items).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.agentToDelete).toBeNull()
    expect(state.deleting).toBe(false)
  })

  it('setAgentToDelete sets and clears pending delete', async () => {
    const { setAgentToDelete } = await import('./agentsSlice')
    const store = await createTestStore()
    store.dispatch(setAgentToDelete(sampleAgent))
    expect(store.getState().agents.agentToDelete).toEqual(sampleAgent)

    store.dispatch(setAgentToDelete(null))
    expect(store.getState().agents.agentToDelete).toBeNull()
  })

  // --- fetchAgents thunk ---
  it('fetchAgents sets loading during pending', async () => {
    let resolve!: (value: Agent[]) => void
    mockGetAll.mockReturnValue(
      new Promise<Agent[]>((r) => {
        resolve = r
      }),
    )

    const store = await createTestStore()
    const { fetchAgents } = await import('./agentsSlice')
    const promise = store.dispatch(fetchAgents())

    expect(store.getState().agents.loading).toBe(true)
    expect(store.getState().agents.error).toBeNull()

    resolve([sampleAgent])
    await promise
  })

  it('fetchAgents populates items on fulfilled', async () => {
    mockGetAll.mockResolvedValue([sampleAgent])

    const store = await createTestStore()
    const { fetchAgents } = await import('./agentsSlice')
    await store.dispatch(fetchAgents())

    const state = store.getState().agents
    expect(state.items).toHaveLength(1)
    expect(state.items[0].name).toBe('Claude Code')
    expect(state.loading).toBe(false)
  })

  it('fetchAgents sets error on rejected', async () => {
    mockGetAll.mockRejectedValue(new Error('Permission denied'))

    const store = await createTestStore()
    const { fetchAgents } = await import('./agentsSlice')
    await store.dispatch(fetchAgents())

    const state = store.getState().agents
    expect(state.loading).toBe(false)
    expect(state.error).toBe('Permission denied')
  })

  // --- removeAllSymlinksFromAgent thunk ---
  it('removeAllSymlinksFromAgent clears agentToDelete on fulfilled', async () => {
    mockRemoveAllFromAgent.mockResolvedValue({
      success: true,
      removedCount: 5,
    })

    const store = await createTestStore()
    const { setAgentToDelete, removeAllSymlinksFromAgent } =
      await import('./agentsSlice')
    store.dispatch(setAgentToDelete(sampleAgent))
    await store.dispatch(removeAllSymlinksFromAgent(sampleAgent))

    expect(store.getState().agents.agentToDelete).toBeNull()
    expect(store.getState().agents.deleting).toBe(false)
  })

  it('removeAllSymlinksFromAgent sets deleting during pending', async () => {
    let resolve!: (value: { success: boolean; removedCount: number }) => void
    mockRemoveAllFromAgent.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )

    const store = await createTestStore()
    const { removeAllSymlinksFromAgent } = await import('./agentsSlice')
    const promise = store.dispatch(removeAllSymlinksFromAgent(sampleAgent))

    expect(store.getState().agents.deleting).toBe(true)

    resolve({ success: true, removedCount: 3 })
    await promise
  })

  it('removeAllSymlinksFromAgent sets error on failure', async () => {
    mockRemoveAllFromAgent.mockResolvedValue({
      success: false,
      error: 'Directory locked',
    })

    const store = await createTestStore()
    const { removeAllSymlinksFromAgent } = await import('./agentsSlice')
    await store.dispatch(removeAllSymlinksFromAgent(sampleAgent))

    expect(store.getState().agents.deleting).toBe(false)
    expect(store.getState().agents.error).toBe('Directory locked')
  })

  it('removeAllSymlinksFromAgent sets error on rejection', async () => {
    mockRemoveAllFromAgent.mockRejectedValue(new Error('Unexpected error'))

    const store = await createTestStore()
    const { removeAllSymlinksFromAgent } = await import('./agentsSlice')
    await store.dispatch(removeAllSymlinksFromAgent(sampleAgent))

    expect(store.getState().agents.deleting).toBe(false)
    // The error comes from the rejected case which has a fallback message
    expect(store.getState().agents.error).toBeTruthy()
  })
})
