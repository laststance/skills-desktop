import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { SyncPreviewResult } from '@/shared/types'

const mockSourceGetStats = vi.fn()
const mockSkillsGetAll = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockRevealInFinder = vi.fn()
const mockOpenInTerminal = vi.fn()
const mockSyncPreview = vi.fn()

// Spy on sonner so toast feedback (refresh failure, sync edge cases) can be
// asserted directly instead of racing the portal-rendered toast DOM.
const toastError = vi.fn()
const toastInfo = vi.fn()
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
    success: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

/** Minimal sync preview with a single create — opens the confirm dialog path. */
const PREVIEW_WITH_WORK: SyncPreviewResult = {
  totalSkills: 2,
  totalAgents: 3,
  toCreate: 4,
  alreadySynced: 0,
  conflicts: [],
}

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
  mockSyncPreview.mockReset()
  mockSyncPreview.mockResolvedValue(PREVIEW_WITH_WORK)
  toastError.mockReset()
  toastInfo.mockReset()
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
    sync: {
      preview: mockSyncPreview,
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

describe('Sidebar → SourceCard refresh', () => {
  it('reloads stats, skills, and agents when Refresh is clicked', async () => {
    // Arrange
    const { screen } = await renderSourceCard()
    // Mount already fetched stats once; clear so we count only the refresh.
    mockSourceGetStats.mockClear()

    // Act
    await screen.getByRole('button', { name: /^Refresh skills/i }).click()

    // Assert
    await vi.waitFor(() => {
      expect(mockSourceGetStats).toHaveBeenCalled()
      expect(mockSkillsGetAll).toHaveBeenCalled()
      expect(mockAgentsGetAll).toHaveBeenCalled()
    })
  })

  it('shows a failure toast when a refresh request rejects', async () => {
    // Arrange — agents refetch fails, so the Promise.all unwrap rejects.
    mockAgentsGetAll.mockRejectedValue(new Error('network down'))
    const { screen } = await renderSourceCard()

    // Act
    await screen.getByRole('button', { name: /^Refresh skills/i }).click()

    // Assert
    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to refresh data')
    })
  })
})

describe('Sidebar → SourceCard folder actions', () => {
  it('opens the folder-actions menu when the kebab button is clicked', async () => {
    // Arrange
    const { screen } = await renderSourceCard()
    // Wait for stats so the kebab trigger is enabled.
    await expect.element(screen.getByText('2 skills')).toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: /Source folder actions/i }).click()

    // Assert
    await expect
      .element(screen.getByText('Reveal in Finder'))
      .toBeInTheDocument()
  })

  it('reveals the source directory in Finder from the menu', async () => {
    // Arrange
    const { screen } = await renderSourceCard()
    await expect.element(screen.getByText('2 skills')).toBeInTheDocument()
    await screen.getByRole('button', { name: /Source folder actions/i }).click()

    // Act
    await screen.getByText('Reveal in Finder').click()

    // Assert
    expect(mockRevealInFinder).toHaveBeenCalledWith(
      '/Users/test/.agents/skills',
    )
  })

  it('opens the source directory in Terminal from the menu', async () => {
    // Arrange
    const { screen } = await renderSourceCard()
    await expect.element(screen.getByText('2 skills')).toBeInTheDocument()
    await screen.getByRole('button', { name: /Source folder actions/i }).click()

    // Act
    await screen.getByText('Open in Terminal').click()

    // Assert
    expect(mockOpenInTerminal).toHaveBeenCalledWith(
      '/Users/test/.agents/skills',
    )
  })

  it('opens the folder-actions menu when the card is right-clicked', async () => {
    // Arrange
    const { screen } = await renderSourceCard()
    await expect.element(screen.getByText('2 skills')).toBeInTheDocument()
    const path = screen.getByText('~/.agents/skills')

    // Act — right-click the card body to open the same menu the kebab opens.
    path
      .element()
      .dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )

    // Assert
    await expect
      .element(screen.getByText('Reveal in Finder'))
      .toBeInTheDocument()
  })

  it('keeps the folder-actions menu closed when right-clicked before stats load', async () => {
    // Arrange — stats fetch never resolves, so sourceStats stays null and the
    // right-click guard must no-op rather than opening an actionless menu.
    mockSourceGetStats.mockReset()
    mockSourceGetStats.mockReturnValue(new Promise(() => {}))
    const { screen } = await renderSourceCard()
    const path = screen.getByText('~/.agents/skills')

    // Act
    path
      .element()
      .dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
      )

    // Assert
    expect(document.body.textContent).not.toContain('Reveal in Finder')
  })

  it('closes the folder-actions menu when dismissed with Escape', async () => {
    // Arrange
    const { screen } = await renderSourceCard()
    await expect.element(screen.getByText('2 skills')).toBeInTheDocument()
    await screen.getByRole('button', { name: /Source folder actions/i }).click()
    await expect
      .element(screen.getByText('Reveal in Finder'))
      .toBeInTheDocument()

    // Act
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )

    // Assert
    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain('Reveal in Finder')
    })
  })
})

describe('Sidebar → SourceCard sync', () => {
  it('stores a sync preview with pending work so a confirm dialog can open', async () => {
    // Arrange
    const { screen, store } = await renderSourceCard()

    // Act
    await screen.getByRole('button', { name: /^Sync$/i }).click()

    // Assert — preview with toCreate>0 is left in Redux for the dialog to read.
    await vi.waitFor(() => {
      expect(store.getState().ui.syncPreview).toEqual(PREVIEW_WITH_WORK)
    })
  })

  it('tells the user there is nothing to sync when no skills exist', async () => {
    // Arrange
    mockSyncPreview.mockResolvedValue({
      totalSkills: 0,
      totalAgents: 3,
      toCreate: 0,
      alreadySynced: 0,
      conflicts: [],
    })
    const { screen, store } = await renderSourceCard()

    // Act
    await screen.getByRole('button', { name: /^Sync$/i }).click()

    // Assert
    await vi.waitFor(() => {
      expect(toastInfo).toHaveBeenCalledWith('No skills to sync')
    })
    expect(store.getState().ui.syncPreview).toBeNull()
  })

  it('tells the user everything is already synced when nothing needs creating', async () => {
    // Arrange
    mockSyncPreview.mockResolvedValue({
      totalSkills: 5,
      totalAgents: 3,
      toCreate: 0,
      alreadySynced: 5,
      conflicts: [],
    })
    const { screen, store } = await renderSourceCard()

    // Act
    await screen.getByRole('button', { name: /^Sync$/i }).click()

    // Assert
    await vi.waitFor(() => {
      expect(toastInfo).toHaveBeenCalledWith('Already synced', {
        description: 'All 5 skills are already linked',
      })
    })
    expect(store.getState().ui.syncPreview).toBeNull()
  })

  it('shows a failure toast when the sync preview request rejects', async () => {
    // Arrange
    mockSyncPreview.mockRejectedValue(new Error('preview blew up'))
    const { screen } = await renderSourceCard()

    // Act
    await screen.getByRole('button', { name: /^Sync$/i }).click()

    // Assert
    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to preview sync')
    })
  })
})
