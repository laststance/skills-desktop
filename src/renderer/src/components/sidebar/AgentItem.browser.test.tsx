import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type { Agent, AgentId } from '@/shared/types'

const mockSettingsSet = vi.fn()
const mockRevealInFinder = vi.fn()
const mockOpenInTerminal = vi.fn()

const FIXTURE_AGENT: Agent = {
  id: 'claude-code',
  name: 'Claude Code',
  path: '/Users/test/.claude/skills',
  exists: true,
  skillCount: 3,
  localSkillCount: 0,
}

beforeEach(() => {
  mockSettingsSet.mockReset()
  mockSettingsSet.mockResolvedValue(undefined)
  mockRevealInFinder.mockReset()
  mockRevealInFinder.mockResolvedValue({ ok: true })
  mockOpenInTerminal.mockReset()
  mockOpenInTerminal.mockResolvedValue({ ok: true })
  // Browser mode replaces the preload context bridge — install fakes for
  // every window.electron.* surface AgentItem can reach.
  vi.stubGlobal('electron', {
    settings: { set: mockSettingsSet },
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
 * Build a store with the slices AgentItem subscribes to. `ui` is needed
 * because `selectedAgentId` drives the selected-styling branch, and
 * `agents` is needed for `setAgentToDelete`/cleanup target dispatchers.
 */
async function createStore(hiddenAgentIds: AgentId[] = []) {
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  return configureStore({
    reducer: {
      settings: settingsReducer,
      ui: uiReducer,
      agents: agentsReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS, hiddenAgentIds },
    },
  })
}

async function renderItem(hiddenAgentIds: AgentId[] = []) {
  const store = await createStore(hiddenAgentIds)
  const { AgentItem } = await import('./AgentItem')
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <AgentItem agent={FIXTURE_AGENT} />
      </TooltipProvider>
    </Provider>,
  )
  return { screen, store }
}

/**
 * Browser-mode regression: AgentItem gained a "Hide from sidebar" /
 * "Show in sidebar" menu item on this branch. These tests pin:
 *  - the right-click menu item opens with the correct label depending
 *    on whether the agent is currently hidden
 *  - selecting that item dispatches `settings:set` with the toggled
 *    hiddenAgentIds array
 *
 * Radix's DropdownMenu portals the content outside the trigger's DOM
 * subtree, so we drive interaction via `contextmenu` on the trigger
 * button (mirrors the production right-click flow).
 */
describe('Sidebar → AgentItem context menu', () => {
  it('offers "Hide from sidebar" in the right-click menu of a visible agent', async () => {
    // Arrange
    const { screen } = await renderItem([])
    const trigger = screen.getByRole('button', {
      name: /Filter skills by Claude Code/i,
    })
    const triggerElement = trigger.element()

    // Act
    // Open the dropdown via right-click on the agent row trigger.
    triggerElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )

    // Assert
    await expect
      .element(screen.getByText(/^Hide from sidebar$/))
      .toBeInTheDocument()
  })

  it('offers "Show in sidebar" in the right-click menu of an already-hidden agent', async () => {
    // Hidden state flips the menu copy — without this branch users would
    // see "Hide from sidebar" on an already-hidden item with no obvious
    // way to restore it from the sidebar context menu.
    // Arrange
    const { screen } = await renderItem(['claude-code'])
    const trigger = screen.getByRole('button', {
      name: /Filter skills by Claude Code/i,
    })
    const triggerElement = trigger.element()

    // Act
    triggerElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )

    // Assert
    await expect
      .element(screen.getByText(/^Show in sidebar$/))
      .toBeInTheDocument()
  })

  it('hides the agent from the sidebar when "Hide from sidebar" is clicked', async () => {
    // The whole point of the menu item — clicking it must reach the IPC
    // boundary with the toggled array. Without this assertion the menu
    // could silently no-op and only Settings → Agents would work.
    // Arrange
    const { screen } = await renderItem([])
    const trigger = screen.getByRole('button', {
      name: /Filter skills by Claude Code/i,
    })
    const triggerElement = trigger.element()
    triggerElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    const hideItem = screen.getByText(/^Hide from sidebar$/)

    // Act
    await hideItem.click()

    // Assert
    expect(mockSettingsSet).toHaveBeenCalledWith({
      hiddenAgentIds: ['claude-code'],
    })
  })

  it('restores the agent to the sidebar when "Show in sidebar" is clicked', async () => {
    // Inverse path — toggling an already-hidden agent must remove it.
    // Arrange
    const { screen } = await renderItem(['claude-code'])
    const trigger = screen.getByRole('button', {
      name: /Filter skills by Claude Code/i,
    })
    const triggerElement = trigger.element()
    triggerElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    const showItem = screen.getByText(/^Show in sidebar$/)

    // Act
    await showItem.click()

    // Assert
    expect(mockSettingsSet).toHaveBeenCalledWith({
      hiddenAgentIds: [],
    })
  })

  it('opens the agent skills folder in Finder when "Reveal in Finder" is clicked', async () => {
    // The folder action must reach the IPC boundary with the agent's own
    // path — a regression here would silently open the wrong (or no) folder.
    // Arrange
    const { screen } = await renderItem([])
    const trigger = screen.getByRole('button', {
      name: /Filter skills by Claude Code/i,
    })
    const triggerElement = trigger.element()
    triggerElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    const revealItem = screen.getByText(/^Reveal in Finder$/)

    // Act
    await revealItem.click()

    // Assert
    expect(mockRevealInFinder).toHaveBeenCalledWith(
      '/Users/test/.claude/skills',
    )
  })

  it('opens the agent skills folder in a terminal when "Open in Terminal" is clicked', async () => {
    // Mirror of the Finder action — the terminal launch must target the
    // agent's path so the shell opens at the right working directory.
    // Arrange
    const { screen } = await renderItem([])
    const trigger = screen.getByRole('button', {
      name: /Filter skills by Claude Code/i,
    })
    const triggerElement = trigger.element()
    triggerElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    const terminalItem = screen.getByText(/^Open in Terminal$/)

    // Act
    await terminalItem.click()

    // Assert
    expect(mockOpenInTerminal).toHaveBeenCalledWith(
      '/Users/test/.claude/skills',
    )
  })

  it('queues the agent for skills-folder deletion when "Delete skills folder" is clicked', async () => {
    // Clicking the destructive item must stage the agent in Redux so the
    // confirmation modal can mount — without it the menu would silently no-op.
    // Arrange
    const { screen, store } = await renderItem([])
    const trigger = screen.getByRole('button', {
      name: /Filter skills by Claude Code/i,
    })
    const triggerElement = trigger.element()
    triggerElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    const deleteItem = screen.getByText(/^Delete skills folder$/)

    // Act
    await deleteItem.click()

    // Assert
    expect(store.getState().agents.agentToDelete).toEqual(FIXTURE_AGENT)
  })

  it('opens the per-agent cleanup dialog when "Cleanup missing skills..." is clicked', async () => {
    // The cleanup item must target the agent by id so CleanupAgentDialog
    // mounts scoped to this agent — a wrong/empty target would clean nothing.
    // Arrange
    const { screen, store } = await renderItem([])
    const trigger = screen.getByRole('button', {
      name: /Filter skills by Claude Code/i,
    })
    const triggerElement = trigger.element()
    triggerElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    const cleanupItem = screen.getByText(/^Cleanup missing skills/)

    // Act
    await cleanupItem.click()

    // Assert
    expect(store.getState().ui.cleanupAgentTarget).toBe('claude-code')
  })
})

describe('Sidebar → AgentItem navigation', () => {
  it('switches Marketplace back to Installed and selects the agent when clicked', async () => {
    // Arrange
    const { screen, store } = await renderItem([])
    const { setActiveTab } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(setActiveTab('marketplace'))

    // Act
    await screen
      .getByRole('button', { name: /Filter skills by Claude Code/i })
      .click()

    // Assert
    expect(store.getState().ui.activeTab).toBe('installed')
    expect(store.getState().ui.selectedAgentId).toBe('claude-code')
  })
})
