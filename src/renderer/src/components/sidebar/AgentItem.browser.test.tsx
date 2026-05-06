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
  it('shows "Hide from sidebar" when the agent is currently visible', async () => {
    const { screen } = await renderItem([])
    // Open the dropdown via right-click on the agent row trigger.
    const trigger = screen.getByRole('button', {
      name: /Filter skills by Claude Code/i,
    })
    const triggerElement = await trigger.element()
    triggerElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    await expect
      .element(screen.getByText(/^Hide from sidebar$/))
      .toBeInTheDocument()
  })

  it('shows "Show in sidebar" when the agent is currently hidden', async () => {
    // Hidden state flips the menu copy — without this branch users would
    // see "Hide from sidebar" on an already-hidden item with no obvious
    // way to restore it from the sidebar context menu.
    const { screen } = await renderItem(['claude-code'])
    const trigger = screen.getByRole('button', {
      name: /Filter skills by Claude Code/i,
    })
    const triggerElement = await trigger.element()
    triggerElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    await expect
      .element(screen.getByText(/^Show in sidebar$/))
      .toBeInTheDocument()
  })

  it('selecting "Hide from sidebar" dispatches settings:set with the agent appended', async () => {
    // The whole point of the menu item — clicking it must reach the IPC
    // boundary with the toggled array. Without this assertion the menu
    // could silently no-op and only Settings → Agents would work.
    const { screen } = await renderItem([])
    const trigger = screen.getByRole('button', {
      name: /Filter skills by Claude Code/i,
    })
    const triggerElement = await trigger.element()
    triggerElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    const hideItem = screen.getByText(/^Hide from sidebar$/)
    await hideItem.click()
    expect(mockSettingsSet).toHaveBeenCalledWith({
      hiddenAgentIds: ['claude-code'],
    })
  })

  it('selecting "Show in sidebar" dispatches settings:set with the agent removed', async () => {
    // Inverse path — toggling an already-hidden agent must remove it.
    const { screen } = await renderItem(['claude-code'])
    const trigger = screen.getByRole('button', {
      name: /Filter skills by Claude Code/i,
    })
    const triggerElement = await trigger.element()
    triggerElement.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
    const showItem = screen.getByText(/^Show in sidebar$/)
    await showItem.click()
    expect(mockSettingsSet).toHaveBeenCalledWith({
      hiddenAgentIds: [],
    })
  })
})
