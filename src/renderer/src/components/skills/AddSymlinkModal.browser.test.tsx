import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { Agent, AgentId, Skill, SkillName } from '../../../../shared/types'

const mockCreateSymlinks = vi.fn()
const mockCopyToAgents = vi.fn()
const mockGetAll = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockSourceGetStats = vi.fn()
const mockOnDeleteProgress = vi.fn(() => () => {})

const toastSuccess = vi.fn()
const toastError = vi.fn()
const toastWarning = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}))

/**
 * Build a minimal agent fixture for modal-selection tests.
 * @param overrides - Partial agent overrides.
 * @returns Complete Agent object.
 * @example
 * makeAgent({ id: 'cursor', name: 'Cursor' })
 */
function makeAgent(
  overrides: Partial<Agent> & Pick<Agent, 'id' | 'name'>,
): Agent {
  const { id, name, ...rest } = overrides
  return {
    id,
    name,
    path: `/home/user/.${id}/skills`,
    exists: true,
    skillCount: 0,
    localSkillCount: 0,
    ...rest,
  }
}

/**
 * Build a minimal global-skill fixture for Add modal tests.
 * @param overrides - Partial skill overrides.
 * @returns Complete Skill object.
 * @example
 * makeSkill({ name: 'task' as SkillName })
 */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'task' as SkillName,
    description: 'Task management skill',
    path: '/home/user/.agents/skills/task',
    symlinkCount: 0,
    symlinks: [],
    isSource: true,
    ...overrides,
  }
}

beforeEach(() => {
  mockCreateSymlinks.mockReset()
  mockCopyToAgents.mockReset()
  mockGetAll.mockReset()
  mockAgentsGetAll.mockReset()
  mockSourceGetStats.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  toastWarning.mockReset()

  mockGetAll.mockResolvedValue([])
  mockAgentsGetAll.mockResolvedValue([])
  mockSourceGetStats.mockResolvedValue(null)

  vi.stubGlobal('electron', {
    skills: {
      createSymlinks: mockCreateSymlinks,
      copyToAgents: mockCopyToAgents,
      getAll: mockGetAll,
      onDeleteProgress: mockOnDeleteProgress,
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
 * Build a real reducer store so modal tests exercise actual thunk/reducer wiring.
 * @returns Redux store with only the slices the modal and refresh thunks need.
 */
async function createStore() {
  const { default: skillsReducer } =
    await import('../../redux/slices/skillsSlice')
  const { default: agentsReducer } =
    await import('../../redux/slices/agentsSlice')
  const { default: uiReducer } = await import('../../redux/slices/uiSlice')

  return configureStore({
    reducer: {
      skills: skillsReducer,
      agents: agentsReducer,
      ui: uiReducer,
    },
  })
}

/**
 * Render the Add modal and seed agent rows through the real fetch thunk.
 * @param options.skill - Skill to open the modal with.
 * @param options.agents - Agent rows returned by the mocked IPC bridge.
 * @returns Render handle and Redux store.
 */
async function renderModal(options: { skill: Skill; agents: Agent[] }) {
  const { skill, agents } = options
  const store = await createStore()
  const { AddSymlinkModal } = await import('./AddSymlinkModal')
  const { fetchAgents } = await import('../../redux/slices/agentsSlice')
  const { setSkillToAddSymlinks } =
    await import('../../redux/slices/skillsSlice')

  mockAgentsGetAll.mockResolvedValue(agents)

  const screen = await render(
    <Provider store={store}>
      <AddSymlinkModal />
    </Provider>,
  )

  await store.dispatch(fetchAgents())
  store.dispatch(setSkillToAddSymlinks(skill))

  await expect
    .element(screen.getByRole('dialog', { name: /Add Skill to Agents/i }))
    .toBeInTheDocument()

  return { screen, store }
}

describe('AddSymlinkModal actions', () => {
  it('renders both Add Symlink and Copy Skill files actions', async () => {
    const { screen } = await renderModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'codex', name: 'Codex' })],
    })

    await expect
      .element(screen.getByRole('button', { name: /^Add Symlink$/i }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: /Copy Skill files/i }))
      .toBeInTheDocument()
  })

  it('dispatches createSymlinks with the existing skill path when Add Symlink is clicked', async () => {
    mockCreateSymlinks.mockResolvedValue({
      success: true,
      created: 1,
      failures: [],
    })

    const { screen } = await renderModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'codex', name: 'Codex' })],
    })

    await screen.getByRole('checkbox', { name: /Codex/i }).click()
    await screen.getByRole('button', { name: /^Add Symlink$/i }).click()

    await expect.poll(() => mockCreateSymlinks.mock.calls.length).toBe(1)
    expect(mockCreateSymlinks.mock.calls[0][0]).toEqual({
      skillName: 'task',
      skillPath: '/home/user/.agents/skills/task',
      agentIds: ['codex'],
    })
  })

  it('dispatches copyToAgents with sourcePath when Copy Skill files is clicked', async () => {
    mockCopyToAgents.mockResolvedValue({
      success: true,
      copied: 1,
      failures: [],
    })

    const { screen } = await renderModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'codex', name: 'Codex' })],
    })

    await screen.getByRole('checkbox', { name: /Codex/i }).click()
    await screen.getByRole('button', { name: /Copy Skill files/i }).click()

    await expect.poll(() => mockCopyToAgents.mock.calls.length).toBe(1)
    expect(mockCopyToAgents.mock.calls[0][0]).toEqual({
      skillName: 'task',
      sourcePath: '/home/user/.agents/skills/task',
      targetAgentIds: ['codex'],
    })
  })

  it('shows a warning toast when copying succeeds only for some agents', async () => {
    mockCopyToAgents.mockResolvedValue({
      success: false,
      copied: 1,
      failures: [{ agentId: 'cursor', error: 'Already exists' }],
    })

    const { screen } = await renderModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'codex', name: 'Codex' })],
    })

    await screen.getByRole('checkbox', { name: /Codex/i }).click()
    await screen.getByRole('button', { name: /Copy Skill files/i }).click()

    await expect.poll(() => toastWarning.mock.calls.length).toBe(1)
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('clears selected agents when the modal closes externally and reopens', async () => {
    const firstSkill = makeSkill({ name: 'task' as SkillName })
    const secondSkill = makeSkill({
      name: 'review' as SkillName,
      path: '/home/user/.agents/skills/review',
    })
    const { screen, store } = await renderModal({
      skill: firstSkill,
      agents: [makeAgent({ id: 'codex', name: 'Codex' })],
    })
    const { setSkillToAddSymlinks } =
      await import('../../redux/slices/skillsSlice')

    await screen.getByRole('checkbox', { name: /Codex/i }).click()
    await expect
      .element(screen.getByRole('checkbox', { name: /Codex/i }))
      .toBeChecked()

    store.dispatch(setSkillToAddSymlinks(null))
    store.dispatch(setSkillToAddSymlinks(secondSkill))

    await expect
      .element(screen.getByRole('dialog', { name: /Add Skill to Agents/i }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('checkbox', { name: /Codex/i }))
      .not.toBeChecked()
  })
})

describe('AddSymlinkModal occupied-agent states', () => {
  it('disables linked, local, and broken destinations with their reason labels', async () => {
    const skill = makeSkill({
      symlinks: [
        {
          agentId: 'claude-code',
          agentName: 'Claude Code',
          status: 'valid',
          targetPath: '/home/user/.agents/skills/task',
          linkPath: '/home/user/.claude/skills/task',
          isLocal: false,
        },
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          targetPath: '',
          linkPath: '/home/user/.cursor/skills/task',
          isLocal: true,
        },
        {
          agentId: 'warp',
          agentName: 'Warp',
          status: 'broken',
          targetPath: '/home/user/.agents/skills/task',
          linkPath: '/home/user/.warp/skills/task',
          isLocal: false,
        },
      ],
    })

    const { screen } = await renderModal({
      skill,
      agents: [
        makeAgent({ id: 'claude-code', name: 'Claude Code' }),
        makeAgent({ id: 'cursor', name: 'Cursor' }),
        makeAgent({ id: 'warp', name: 'Warp' }),
        makeAgent({ id: 'codex', name: 'Codex' }),
      ],
    })

    await expect
      .element(screen.getByRole('checkbox', { name: /Claude Code/i }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('checkbox', { name: /Cursor/i }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('checkbox', { name: /Warp/i }))
      .toBeDisabled()
    await expect
      .element(screen.getByText('linked', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('local', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('broken link', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('checkbox', { name: /Codex/i }))
      .toBeEnabled()
  })
})

describe('AddSymlinkModal busy state', () => {
  it('keeps the modal open and disables both actions while adding symlinks', async () => {
    const skill = makeSkill()
    const { screen, store } = await renderModal({
      skill,
      agents: [makeAgent({ id: 'codex', name: 'Codex' })],
    })

    const { createSymlinks } = await import('../../redux/slices/skillsSlice')
    store.dispatch(
      createSymlinks.pending('adding-request', {
        skill,
        agentIds: ['codex' as AgentId],
      }),
    )

    await expect
      .element(screen.getByRole('button', { name: /Adding/i }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('button', { name: /Copy Skill files/i }))
      .toBeDisabled()

    await screen.getByRole('button', { name: /^Close$/i }).click()

    await expect
      .element(screen.getByRole('dialog', { name: /Add Skill to Agents/i }))
      .toBeInTheDocument()
    expect(store.getState().skills.skillToAddSymlinks?.name).toBe('task')
  })

  it('keeps the modal open and disables both actions while copying files', async () => {
    const skill = makeSkill()
    const { screen, store } = await renderModal({
      skill,
      agents: [makeAgent({ id: 'codex', name: 'Codex' })],
    })

    const { copyToAgents } = await import('../../redux/slices/skillsSlice')
    store.dispatch(
      copyToAgents.pending('copying-request', {
        skill,
        sourcePath: skill.path,
        agentIds: ['codex' as AgentId],
      }),
    )

    await expect
      .element(screen.getByRole('button', { name: /^Add Symlink$/i }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('button', { name: /Copying/i }))
      .toBeDisabled()

    await screen.getByRole('button', { name: /^Close$/i }).click()

    await expect
      .element(screen.getByRole('dialog', { name: /Add Skill to Agents/i }))
      .toBeInTheDocument()
    expect(store.getState().skills.skillToAddSymlinks?.name).toBe('task')
  })
})
