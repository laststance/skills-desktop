import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type { Agent, AgentId } from '@/shared/types'

const mockSettingsSet = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockRevealInFinder = vi.fn()
const mockOpenInTerminal = vi.fn()

/**
 * Two-agent fixture covers the visible/hidden split paths without inflating
 * the store with the full 44-agent matrix.
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

const NOT_INSTALLED_AGENT: Agent = {
  id: 'codex' as AgentId,
  name: 'Codex',
  path: '/Users/test/.codex/skills',
  exists: false,
  skillCount: 0,
  localSkillCount: 0,
}

beforeEach(() => {
  mockSettingsSet.mockReset()
  mockSettingsSet.mockResolvedValue(undefined)
  mockAgentsGetAll.mockReset()
  mockAgentsGetAll.mockResolvedValue(FIXTURE_AGENTS)
  mockRevealInFinder.mockReset()
  mockRevealInFinder.mockResolvedValue({ ok: true })
  mockOpenInTerminal.mockReset()
  mockOpenInTerminal.mockResolvedValue({ ok: true })
  // Browser mode replaces the preload context bridge — install fakes for every
  // window.electron.* surface AgentItem can reach (settings, folder, agents).
  vi.stubGlobal('electron', {
    settings: {
      set: mockSettingsSet,
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
 * Build a minimal Redux store with the slices AgentsSection / AgentItem read.
 * Pre-seeds `agents.items` so the on-mount fetchAgents() doesn't race the
 * assertions in the loading branch.
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
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  return configureStore({
    reducer: {
      settings: settingsReducer,
      agents: agentsReducer,
      ui: uiReducer,
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

async function renderSection(
  hiddenAgentIds: AgentId[] = [],
  items: Agent[] = FIXTURE_AGENTS,
  loading = false,
) {
  const store = await createStore(hiddenAgentIds, items, loading)
  const { AgentsSection } = await import('./AgentsSection')
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <AgentsSection />
      </TooltipProvider>
    </Provider>,
  )
  return { screen, store }
}

/**
 * Browser-mode regression: AgentsSection is the sidebar surface for the
 * hide-from-sidebar feature. These tests pin the four render branches that
 * only exist on this branch:
 *  - loading placeholder
 *  - "All installed agents are hidden" empty-after-hide message
 *  - the "N hidden" disclosure
 *  - "(n)" header counter reflects ONLY visible agents
 */
describe('Sidebar → AgentsSection', () => {
  it('shows the loading placeholder while agents.loading is true', async () => {
    // Pre-seed the loading flag and force the on-mount fetchAgents() to never
    // resolve so the placeholder survives the assertion window.
    mockAgentsGetAll.mockReturnValueOnce(new Promise(() => {}))
    const { screen } = await renderSection([], [], true)
    await expect.element(screen.getByText(/Loading\.\.\./i)).toBeInTheDocument()
  })

  it('shows "No agents detected" when nothing is installed', async () => {
    // totalInstalled === 0 branch — happens on a fresh machine where no agent
    // directories exist yet.
    mockAgentsGetAll.mockResolvedValueOnce([])
    const { screen } = await renderSection([], [], false)
    await expect
      .element(screen.getByText(/No agents detected/i))
      .toBeInTheDocument()
  })

  it('shows the all-hidden hint when every installed agent is hidden', async () => {
    // Distinct fall-through: totalInstalled > 0 but visibleInstalled.length === 0.
    // The user has installed agents but hidden every one; copy points back at
    // Settings → Agents so they can recover without leaving the sidebar.
    const allHidden: AgentId[] = ['claude-code', 'cursor']
    const { screen } = await renderSection(allHidden)
    await expect
      .element(screen.getByText(/All installed agents are hidden/i))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText(/Open Settings . Agents to show some/i))
      .toBeInTheDocument()
  })

  it('renders the "N hidden" disclosure when at least one agent is hidden', async () => {
    // The disclosure exists ONLY when hiddenInstalled.length > 0 — the inverse
    // case (no hidden agents → no disclosure) is implicitly covered by the
    // visible-counter test below.
    const { screen } = await renderSection(['cursor'])
    await expect.element(screen.getByText(/^1 hidden$/)).toBeInTheDocument()
  })

  it('header counter reflects ONLY visible agents, not the total installed set', async () => {
    // With one hidden of two installed, the "(n)" counter must show "(1)"
    // rather than "(2)" — otherwise the user can't tell at a glance that a
    // hide is in effect.
    const { screen } = await renderSection(['cursor'])
    await expect.element(screen.getByText(/^\(1\)$/)).toBeInTheDocument()
  })

  it('renders the "N not installed" disclosure alongside hidden when both exist', async () => {
    // missingAgents.length > 0 path coexists with hiddenInstalled.length > 0;
    // both disclosures must render. Pinning the dual case here guards against
    // a future refactor that conflates the two lists.
    //
    // Override the fetchAgents resolution too — the on-mount effect would
    // otherwise resolve with FIXTURE_AGENTS and drop the NOT_INSTALLED seed.
    const itemsWithMissing = [...FIXTURE_AGENTS, NOT_INSTALLED_AGENT]
    mockAgentsGetAll.mockResolvedValueOnce(itemsWithMissing)
    const { screen } = await renderSection(['cursor'], itemsWithMissing)
    await expect.element(screen.getByText(/^1 hidden$/)).toBeInTheDocument()
    await expect
      .element(screen.getByText(/^1 not installed$/))
      .toBeInTheDocument()
  })
})
