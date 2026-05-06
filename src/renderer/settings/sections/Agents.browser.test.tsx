import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type { Agent, AgentId } from '@/shared/types'

const mockSettingsSet = vi.fn()
const mockAgentsGetAll = vi.fn()

/**
 * Two-agent fixture is enough to exercise the toggle/show-all paths without
 * dragging the full 44-agent matrix into the DOM each test.
 */
const FIXTURE_AGENTS: Agent[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    path: '/Users/test/.claude/skills',
    exists: true,
    skillCount: 3,
    localSkillCount: 0,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    path: '/Users/test/.cursor/skills',
    exists: true,
    skillCount: 1,
    localSkillCount: 0,
  },
]

beforeEach(() => {
  mockSettingsSet.mockReset()
  mockSettingsSet.mockResolvedValue(undefined)
  mockAgentsGetAll.mockReset()
  mockAgentsGetAll.mockResolvedValue(FIXTURE_AGENTS)
  // Browser mode replaces the preload context bridge — install a fake so the
  // optimistic-then-IPC pair in `useUpdateSettings` doesn't crash on
  // `window.electron.settings.set`.
  vi.stubGlobal('electron', {
    settings: {
      set: mockSettingsSet,
      // No `get` / `subscribe` needed — Agents.tsx never calls them; the
      // store seed already represents what `useSettingsSync` would deliver.
    },
    agents: {
      getAll: mockAgentsGetAll,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build a minimal Redux store with the slices Agents.tsx reads.
 * Seeds `agents.items` directly so the section renders immediately
 * without waiting on the mount-time fetch effect.
 * @param hiddenAgentIds - initial hidden ids (defaults to `[]`)
 */
async function createStore(hiddenAgentIds: AgentId[] = []) {
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  return configureStore({
    reducer: {
      settings: settingsReducer,
      agents: agentsReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS, hiddenAgentIds },
      agents: {
        items: FIXTURE_AGENTS,
        loading: false,
        error: null,
        agentToDelete: null,
        deleting: false,
      },
    },
  })
}

async function renderAgents(hiddenAgentIds: AgentId[] = []) {
  const store = await createStore(hiddenAgentIds)
  const { Agents } = await import('./Agents')
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <Agents />
      </TooltipProvider>
    </Provider>,
  )
  return { screen, store }
}

/**
 * Browser-mode regression: the Agents settings pane is the user-facing knob
 * for `hiddenAgentIds`. These tests pin the contract main → renderer relies
 * on:
 *  - unchecking a row appends that agent id to `hiddenAgentIds`
 *  - re-checking it removes the id again
 *  - "Show all" clears the array entirely
 *  - "Show all" is disabled when nothing is hidden
 */
describe('Settings → Agents', () => {
  it('unchecking an installed agent appends its id to hiddenAgentIds', async () => {
    const { screen } = await renderAgents([])

    const claudeCheckbox = screen.getByRole('checkbox', {
      name: /Show Claude Code in sidebar/i,
    })
    await claudeCheckbox.click()

    expect(mockSettingsSet).toHaveBeenCalledTimes(1)
    expect(mockSettingsSet).toHaveBeenCalledWith({
      hiddenAgentIds: ['claude-code'],
    })
  })

  it('re-checking a hidden agent removes its id from hiddenAgentIds', async () => {
    const { screen } = await renderAgents(['claude-code'])

    const claudeCheckbox = screen.getByRole('checkbox', {
      name: /Show Claude Code in sidebar/i,
    })
    await claudeCheckbox.click()

    expect(mockSettingsSet).toHaveBeenCalledWith({
      hiddenAgentIds: [],
    })
  })

  it('"Show all" clears every hidden agent', async () => {
    const { screen } = await renderAgents(['claude-code', 'cursor'])

    const showAllButton = screen.getByRole('button', { name: /Show all/i })
    await showAllButton.click()

    expect(mockSettingsSet).toHaveBeenCalledWith({
      hiddenAgentIds: [],
    })
  })

  it('"Show all" is disabled when nothing is hidden', async () => {
    const { screen } = await renderAgents([])

    const showAllButton = screen.getByRole('button', { name: /Show all/i })
    await expect.element(showAllButton).toBeDisabled()
  })

  it('renders the "X visible · Y hidden" counter', async () => {
    const { screen } = await renderAgents(['cursor'])

    // 2 installed, 1 hidden → 1 visible · 1 hidden
    await expect
      .element(screen.getByText(/1 visible · 1 hidden/i))
      .toBeInTheDocument()
  })
})
