import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { repositoryId } from '@/shared/types'
import type { Agent, SkillSearchResult } from '@/shared/types'

const mockInstall = vi.fn()
const mockCancel = vi.fn()
const mockSearch = vi.fn()
const mockLeaderboard = vi.fn()
const mockSkillsGetAll = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockOnDeleteProgress = vi.fn(() => () => {})

/**
 * Build a minimal Marketplace skill fixture for install dialog tests.
 * @param overrides - Fields that differ from the default fixture.
 * @returns Complete SkillSearchResult used by the real marketplace reducer.
 * @example
 * makeSkill({ name: 'lint' })
 */
function makeSkill(
  overrides: Partial<SkillSearchResult> = {},
): SkillSearchResult {
  return {
    rank: 1,
    name: 'task',
    repo: repositoryId('vercel-labs/skills'),
    url: 'https://skills.sh/vercel-labs/skills/task',
    installCount: 100,
    ...overrides,
  }
}

/**
 * Build a minimal agent row fixture for the symlink destination picker.
 * @param overrides - Agent id/name plus any fields that need to vary.
 * @returns Complete Agent object accepted by agentsSlice.
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

beforeEach(() => {
  mockInstall.mockReset()
  mockCancel.mockReset()
  mockSearch.mockReset()
  mockLeaderboard.mockReset()
  mockSkillsGetAll.mockReset()
  mockAgentsGetAll.mockReset()
  mockOnDeleteProgress.mockClear()

  mockInstall.mockResolvedValue({ success: true })
  mockSkillsGetAll.mockResolvedValue([])
  mockAgentsGetAll.mockResolvedValue([])
  mockLeaderboard.mockResolvedValue([])

  vi.stubGlobal('electron', {
    skillsCli: {
      search: mockSearch,
      install: mockInstall,
      cancel: mockCancel,
      onProgress: vi.fn(() => () => {}),
    },
    skills: {
      getAll: mockSkillsGetAll,
      onDeleteProgress: mockOnDeleteProgress,
    },
    agents: {
      getAll: mockAgentsGetAll,
    },
    marketplace: {
      leaderboard: mockLeaderboard,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build the reducer store used by InstallModal and its refresh thunk.
 * @returns Redux store with marketplace, agents, and skills slices.
 * @example
 * const store = await createStore()
 */
async function createStore() {
  const [
    { default: marketplaceReducer },
    { default: agentsReducer },
    { default: skillsReducer },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/marketplaceSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
  ])

  return configureStore({
    reducer: {
      marketplace: marketplaceReducer,
      agents: agentsReducer,
      skills: skillsReducer,
    },
  })
}

/**
 * Render InstallModal after seeding the selected Marketplace skill and agents.
 * @param options.skill - Marketplace skill selected from the results row.
 * @param options.agents - Agents returned by the mocked IPC bridge.
 * @returns Render handle plus the Redux store.
 * @example
 * await renderInstallModal({ skill: makeSkill(), agents: [makeAgent({ id: 'claude-code', name: 'Claude Code' })] })
 */
async function renderInstallModal(options: {
  skill: SkillSearchResult
  agents: Agent[]
}) {
  const store = await createStore()
  const { InstallModal } = await import('./InstallModal')
  const { fetchAgents } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { selectSkillForInstall } =
    await import('@/renderer/src/redux/slices/marketplaceSlice')

  mockAgentsGetAll.mockResolvedValue(options.agents)

  const screen = await render(
    <Provider store={store}>
      <InstallModal />
    </Provider>,
  )

  await store.dispatch(fetchAgents())
  store.dispatch(selectSkillForInstall(options.skill))

  await expect
    .element(screen.getByRole('dialog', { name: 'Install Skill' }))
    .toBeInTheDocument()

  return { screen, store }
}

describe('InstallModal target selection', () => {
  it('installs to Universal and creates symlinks for the checked agent by default', async () => {
    // Arrange
    const { screen } = await renderInstallModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'claude-code', name: 'Claude Code' })],
    })

    // Act
    await screen.getByRole('button', { name: 'Install' }).click()

    // Assert
    await expect.poll(() => mockInstall.mock.calls.length).toBe(1)
    expect(mockInstall).toHaveBeenCalledWith({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: ['claude-code'],
      skills: ['task'],
    })
  })

  it('installs to Universal only without passing any agent symlink targets', async () => {
    // Arrange
    const { screen } = await renderInstallModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'claude-code', name: 'Claude Code' })],
    })

    // Act
    await screen.getByRole('radio', { name: 'Universal only' }).click()
    await screen.getByRole('button', { name: 'Install' }).click()

    // Assert
    await expect.poll(() => mockInstall.mock.calls.length).toBe(1)
    expect(mockInstall).toHaveBeenCalledWith({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: [],
      skills: ['task'],
    })
  })

  it('falls back to Universal only when no agent directories are available', async () => {
    // Arrange
    const { screen } = await renderInstallModal({
      skill: makeSkill(),
      agents: [],
    })

    // Assert
    await expect
      .element(screen.getByRole('radio', { name: 'Universal only' }))
      .toBeChecked()
    await expect
      .element(
        screen.getByRole('radio', { name: 'Universal plus selected agents' }),
      )
      .toBeDisabled()

    // Act
    await screen.getByRole('button', { name: 'Install' }).click()

    // Assert
    await expect.poll(() => mockInstall.mock.calls.length).toBe(1)
    expect(mockInstall).toHaveBeenCalledWith({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: [],
      skills: ['task'],
    })
  })

  it('requires at least one symlink agent when Universal plus agents is selected', async () => {
    // Arrange
    const { screen } = await renderInstallModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'claude-code', name: 'Claude Code' })],
    })

    // Act
    await screen.getByRole('checkbox', { name: 'Claude Code' }).click()

    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Install' }))
      .toBeDisabled()
    await expect
      .element(screen.getByText('Please select at least one agent'))
      .toBeInTheDocument()
    expect(mockInstall).not.toHaveBeenCalled()
  })

  it('ignores the default symlink target when that agent is not installed', async () => {
    // Arrange
    const { screen } = await renderInstallModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'cursor', name: 'Cursor' })],
    })

    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Install' }))
      .toBeDisabled()
    await expect
      .element(screen.getByText('Please select at least one agent'))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('checkbox', { name: 'Cursor' }).click()
    await screen.getByRole('button', { name: 'Install' }).click()

    // Assert
    await expect.poll(() => mockInstall.mock.calls.length).toBe(1)
    expect(mockInstall).toHaveBeenCalledWith({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: ['cursor'],
      skills: ['task'],
    })
  })

  it('passes every checked agent when creating Universal symlinks', async () => {
    // Arrange
    const { screen } = await renderInstallModal({
      skill: makeSkill(),
      agents: [
        makeAgent({ id: 'claude-code', name: 'Claude Code' }),
        makeAgent({ id: 'cursor', name: 'Cursor' }),
      ],
    })

    // Act
    await screen.getByRole('checkbox', { name: 'Cursor' }).click()
    await screen.getByRole('button', { name: 'Install' }).click()

    // Assert
    await expect.poll(() => mockInstall.mock.calls.length).toBe(1)
    expect(mockInstall).toHaveBeenCalledWith({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: ['claude-code', 'cursor'],
      skills: ['task'],
    })
  })
})
