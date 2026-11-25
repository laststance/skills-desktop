import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import {
  repositoryId,
  toAbsolutePath,
  toHttpUrl,
  toInstallCount,
  toSkillCount,
  toSkillName,
  toSkillRank,
  toSymlinkCount,
} from '@/shared/types'
import type { Agent, Skill, SkillSearchResult } from '@/shared/types'

const mockInstall = vi.fn()
const mockCancel = vi.fn()
const mockSearch = vi.fn()
const mockLeaderboard = vi.fn()
const mockSkillsGetAll = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockOnDeleteProgress = vi.fn(() => (): void => {})

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
    rank: toSkillRank(1),
    name: toSkillName('task'),
    repo: repositoryId('vercel-labs/skills'),
    url: toHttpUrl('https://skills.sh/vercel-labs/skills/task'),
    installCount: toInstallCount(100),
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
    path: toAbsolutePath(`/home/user/.${id}/skills`),
    exists: true,
    skillCount: toSkillCount(0),
    localSkillCount: toSkillCount(0),
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
      onProgress: vi.fn(() => (): void => {}),
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
  installed?: Skill[]
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

  if (options.installed) {
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    mockSkillsGetAll.mockResolvedValue(options.installed)
    await store.dispatch(fetchSkills())
  }
  await store.dispatch(fetchAgents())
  store.dispatch(selectSkillForInstall(options.skill))

  await expect.element(screen.getByRole('dialog')).toBeInTheDocument()

  return { screen, store }
}

describe('InstallModal target selection', () => {
  test('compares the installed and requested repositories before running the installer', async () => {
    // Arrange
    const installed: Skill = {
      name: toSkillName('task'),
      source: repositoryId('other/skills'),
      description: 'Locally installed',
      path: toAbsolutePath('/skills/task'),
      symlinks: [],
      symlinkCount: toSymlinkCount(0),
      isSource: true,
      isOrphan: false,
    }

    // Act
    const { screen } = await renderInstallModal({
      skill: makeSkill(),
      agents: [],
      installed: [installed],
    })

    // Assert
    await expect
      .element(screen.getByRole('dialog', { name: 'Compare sources' }))
      .toBeVisible()
    await expect.element(screen.getByText('other/skills')).toBeVisible()
    await expect.element(screen.getByText('vercel-labs/skills')).toBeVisible()
    await screen.getByRole('button', { name: 'Cancel' }).click()
    expect(mockInstall).not.toHaveBeenCalled()
  })

  test('installs to Universal and creates symlinks for the checked agent by default', async () => {
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

  test('installs to Universal only without passing any agent symlink targets', async () => {
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

  test.each([
    { agents: [] },
    { agents: [makeAgent({ id: 'cursor', name: 'Cursor' })] },
  ])(
    'offers only the shared directory when no separate agent link is available (%#)',
    async ({ agents }) => {
      // Arrange
      const { screen } = await renderInstallModal({
        skill: makeSkill(),
        agents,
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
    },
  )

  test('requires at least one symlink agent when Universal plus agents is selected', async () => {
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

  test('ignores the default symlink target when that agent is not installed', async () => {
    // Arrange
    const { screen } = await renderInstallModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'goose', name: 'Goose' })],
    })

    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Install' }))
      .toBeDisabled()
    await expect
      .element(screen.getByText('Please select at least one agent'))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('checkbox', { name: 'Goose' }).click()
    await screen.getByRole('button', { name: 'Install' }).click()

    // Assert
    await expect.poll(() => mockInstall.mock.calls.length).toBe(1)
    expect(mockInstall).toHaveBeenCalledWith({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: ['goose'],
      skills: ['task'],
    })
  })

  test('passes every checked agent when creating Universal symlinks', async () => {
    // Arrange
    const { screen } = await renderInstallModal({
      skill: makeSkill(),
      agents: [
        makeAgent({ id: 'claude-code', name: 'Claude Code' }),
        makeAgent({ id: 'goose', name: 'Goose' }),
      ],
    })

    // Act
    await screen.getByRole('checkbox', { name: 'Goose' }).click()
    await screen.getByRole('button', { name: 'Install' }).click()

    // Assert
    await expect.poll(() => mockInstall.mock.calls.length).toBe(1)
    expect(mockInstall).toHaveBeenCalledWith({
      repo: repositoryId('vercel-labs/skills'),
      global: true,
      agents: ['claude-code', 'goose'],
      skills: ['task'],
    })
  })
})

describe('InstallModal install outcome', () => {
  test('closes the dialog once the install succeeds', async () => {
    // Arrange
    mockInstall.mockResolvedValue({ success: true })
    const { screen } = await renderInstallModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'claude-code', name: 'Claude Code' })],
    })

    // Act
    await screen.getByRole('button', { name: 'Install' }).click()

    // Assert
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  })

  test('stays open with the failure inline when the CLI reports no success', async () => {
    // Arrange — the fast-failing spawn regression: the dialog used to close in
    // the same frame, so a missing npx looked exactly like a no-op click.
    mockInstall.mockResolvedValue({
      success: false,
      userMessage:
        'Couldn’t find the npx command. Install Node.js — or add your version manager’s shims to PATH — then relaunch the app.',
    })
    const { screen } = await renderInstallModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'claude-code', name: 'Claude Code' })],
    })

    // Act
    await screen.getByRole('button', { name: 'Install' }).click()

    // Assert
    await expect
      .element(screen.getByRole('dialog', { name: 'Install Skill' }))
      .toBeVisible()
    await expect.element(screen.getByRole('alert')).toBeVisible()
    await expect
      .element(
        screen.getByText(
          'Couldn’t find the npx command. Install Node.js — or add your version manager’s shims to PATH — then relaunch the app.',
        ),
      )
      .toBeVisible()
  })

  test('offers a working retry after a failure', async () => {
    // Arrange — first attempt fails, second succeeds: the error must clear
    // while retrying and the dialog must close on the success.
    mockInstall
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true })
    const { screen } = await renderInstallModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'claude-code', name: 'Claude Code' })],
    })

    // Act — the failure keeps the dialog open
    await screen.getByRole('button', { name: 'Install' }).click()
    await expect.element(screen.getByRole('alert')).toBeVisible()

    // Act — the retry clears the inline error, then closes on success
    await screen.getByRole('button', { name: 'Install' }).click()

    // Assert
    await expect.poll(() => mockInstall.mock.calls.length).toBe(2)
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  })

  test('drops the inline error when the user cancels after a failure', async () => {
    // Arrange — closing the modal ends the episode; reopening must not reshow
    // the previous failure.
    mockInstall.mockResolvedValue({ success: false })
    const { screen, store } = await renderInstallModal({
      skill: makeSkill(),
      agents: [makeAgent({ id: 'claude-code', name: 'Claude Code' })],
    })

    // Act
    await screen.getByRole('button', { name: 'Install' }).click()
    await expect.element(screen.getByRole('alert')).toBeVisible()
    await screen.getByRole('button', { name: 'Cancel' }).click()

    // Assert
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
    expect(store.getState().marketplace.error).toBeNull()
  })
})
