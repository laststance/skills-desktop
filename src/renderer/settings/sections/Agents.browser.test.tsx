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
 * @param items - agent items to seed (defaults to FIXTURE_AGENTS)
 * @param loading - agents.loading flag (defaults to false)
 */
async function createStore(
  hiddenAgentIds: AgentId[] = [],
  items: Agent[] = FIXTURE_AGENTS,
  loading = false,
) {
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
        items,
        loading,
        error: null,
        agentToDelete: null,
        deleting: false,
      },
    },
  })
}

async function renderAgents(
  hiddenAgentIds: AgentId[] = [],
  items: Agent[] = FIXTURE_AGENTS,
  loading = false,
) {
  const store = await createStore(hiddenAgentIds, items, loading)
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

  it('shows the loading placeholder while agents.loading is true and the list is empty', async () => {
    // Settings can open before the main window has finished its first
    // scan. Without the loading placeholder users see "No agents
    // detected" mid-scan and panic that nothing's installed.
    //
    // The component re-fires fetchAgents on mount when items is empty.
    // Force the in-flight Promise to never resolve so the seeded
    // `loading: true` flag survives long enough for the assertion.
    mockAgentsGetAll.mockReturnValueOnce(new Promise(() => {}))
    const { screen } = await renderAgents([], [], true)
    await expect
      .element(screen.getByText(/Loading agents/i))
      .toBeInTheDocument()
  })

  it('shows the empty-installed message when no agents are detected', async () => {
    // Distinct copy from the loading state — once the scan finishes and
    // genuinely finds nothing, the user gets a fresh-machine hint.
    //
    // Override the default fixture: the empty preloaded state triggers
    // an on-mount fetchAgents() that would otherwise resolve to
    // FIXTURE_AGENTS and replace the empty list.
    mockAgentsGetAll.mockResolvedValueOnce([])
    const { screen } = await renderAgents([], [], false)
    await expect
      .element(screen.getByText(/No agents detected on this machine/i))
      .toBeInTheDocument()
  })

  it('renders a disabled disclosure for not-installed agents', async () => {
    // The "N not installed" details/summary is the only place the user
    // sees uninstalled agents in this pane. Ensure it shows up with the
    // count and a disabled checkbox so a future refactor cannot
    // accidentally make these toggleable.
    const NOT_INSTALLED_AGENT: Agent = {
      id: 'codex' as AgentId,
      name: 'Codex',
      path: '/Users/test/.codex/skills',
      exists: false,
      skillCount: 0,
      localSkillCount: 0,
    }
    const { screen } = await renderAgents(
      [],
      [...FIXTURE_AGENTS, NOT_INSTALLED_AGENT],
    )
    // Summary always renders even when <details> is collapsed.
    await expect
      .element(screen.getByText(/1 not installed/i))
      .toBeInTheDocument()
    // Expand the disclosure so the disabled checkbox inside is visible
    // to the role query — collapsed <details> hides children from the
    // accessibility tree.
    const summary = screen.getByText(/1 not installed/i)
    await summary.click()
    const disabledCheckbox = screen.getByRole('checkbox', {
      name: /Codex \(not installed\)/i,
    })
    await expect.element(disabledCheckbox).toBeDisabled()
  })

  it('renders a "Hidden" tag inside the row of a hidden agent', async () => {
    // Visual cue inside the row tells the user at a glance which agents
    // are currently hidden — without it the only signal is the unchecked
    // checkbox, easy to miss while scanning a long list.
    const { screen } = await renderAgents(['claude-code'])
    // The "Hidden" label is rendered inside the label wrapping the
    // claude-code row. There is exactly one match in this fixture.
    await expect.element(screen.getByText(/^Hidden$/)).toBeInTheDocument()
  })
})
