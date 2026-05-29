import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

const mockSourceGetStats = vi.fn()
const mockSkillsGetAll = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockRevealInFinder = vi.fn()
const mockOpenInTerminal = vi.fn()

beforeEach(() => {
  mockSourceGetStats.mockReset()
  mockSourceGetStats.mockResolvedValue({
    path: '/Users/test/.agents/skills',
    skillCount: 2,
    totalSize: '4 KB',
  })
  mockSkillsGetAll.mockReset()
  mockSkillsGetAll.mockResolvedValue([])
  mockAgentsGetAll.mockReset()
  mockAgentsGetAll.mockResolvedValue([])
  mockRevealInFinder.mockReset()
  mockRevealInFinder.mockResolvedValue({ ok: true })
  mockOpenInTerminal.mockReset()
  mockOpenInTerminal.mockResolvedValue({ ok: true })
  // SourceCard's mount effect reads source stats through the preload bridge;
  // browser-mode tests replace that bridge, so each IPC surface is stubbed.
  vi.stubGlobal('electron', {
    source: {
      getStats: mockSourceGetStats,
    },
    skills: {
      getAll: mockSkillsGetAll,
    },
    agents: {
      getAll: mockAgentsGetAll,
    },
    folder: {
      revealInFinder: mockRevealInFinder,
      openInTerminal: mockOpenInTerminal,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build the narrow store SourceCard reads and dispatches through.
 * @returns Redux store with real ui, skills, and agents reducers.
 */
async function createStore() {
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')

  return configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
      agents: agentsReducer,
    },
  })
}

async function renderSourceCard() {
  const store = await createStore()
  const { SourceCard } = await import('./SourceCard')
  const screen = await render(
    <Provider store={store}>
      <SourceCard />
    </Provider>,
  )
  return { screen, store }
}

describe('Sidebar → SourceCard navigation', () => {
  it('switches Marketplace back to Installed and clears filters when clicked', async () => {
    // Arrange
    const { screen, store } = await renderSourceCard()
    const { selectAgent, setActiveTab, setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(setActiveTab('marketplace'))
    store.dispatch(selectAgent('claude-code'))
    store.dispatch(setSearchQuery('task'))

    // Act
    await screen.getByText('~/.agents/skills').click()

    // Assert
    expect(store.getState().ui.activeTab).toBe('installed')
    expect(store.getState().ui.selectedAgentId).toBeNull()
    expect(store.getState().ui.searchQuery).toBe('')
  })
})
