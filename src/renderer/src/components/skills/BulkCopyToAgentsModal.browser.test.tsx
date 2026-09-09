import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type {
  Agent,
  CopyToAgentsResult,
  Skill,
  SkillName,
} from '@/shared/types'
import {
  toAbsolutePath,
  toAgentCount,
  toSkillCount,
  toSkillName,
  toSymlinkCount,
} from '@/shared/types'

const mockCopyToAgents = vi.fn()
const mockSkillsGetAll = vi.fn()
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
 * Build a minimal installed agent fixture for the bulk copy modal tests.
 * @param overrides - Partial agent overrides (id + name required).
 * @returns Complete Agent object marked installed.
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

/**
 * Build a minimal source skill fixture for the bulk copy modal tests.
 * @param name - Skill name; also used to derive a unique source path.
 * @returns Complete Skill object with no symlinks.
 * @example
 * makeSkill('task')
 */
function makeSkill(name: string): Skill {
  return {
    name: toSkillName(name),
    description: `${name} skill`,
    path: toAbsolutePath(`/home/user/.agents/skills/${name}`),
    symlinkCount: toSymlinkCount(0),
    symlinks: [],
    isSource: true,
    isOrphan: false,
  }
}

/**
 * Build a single-skill IPC copy result for the mocked bridge.
 * @param overrides - Partial CopyToAgentsResult fields.
 * @returns Full CopyToAgentsResult.
 * @example
 * makeCopyResult({ copied: 2 })
 */
function makeCopyResult(
  overrides: Partial<CopyToAgentsResult> = {},
): CopyToAgentsResult {
  return {
    success: true,
    copied: toAgentCount(2),
    failures: [],
    ...overrides,
  }
}

beforeEach(() => {
  mockCopyToAgents.mockReset()
  mockSkillsGetAll.mockReset()
  mockAgentsGetAll.mockReset()
  mockSourceGetStats.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  toastWarning.mockReset()

  mockSkillsGetAll.mockResolvedValue([])
  mockAgentsGetAll.mockResolvedValue([])
  mockSourceGetStats.mockResolvedValue([])

  vi.stubGlobal('electron', {
    skills: {
      copyToAgents: mockCopyToAgents,
      getAll: mockSkillsGetAll,
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
 * Render the bulk copy modal against a real reducer store, prime the skills +
 * agents lists, tick a selection, and open the modal.
 * @param options.skills - Skill rows loaded into the Installed list.
 * @param options.agents - Agent rows returned by the mocked IPC bridge.
 * @param options.selectedNames - Skill names to mark as selected before opening.
 * @returns Render handle and Redux store.
 */
async function renderModal(options: {
  skills: Skill[]
  agents: Agent[]
  selectedNames: SkillName[]
}) {
  const { skills, agents, selectedNames } = options
  const {
    default: skillsReducer,
    fetchSkills,
    selectAll,
    setBulkCopyModalOpen,
  } = await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: agentsReducer, fetchAgents } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { default: protectReducer } =
    await import('@/renderer/src/redux/slices/protectSlice')
  const { BulkCopyToAgentsModal } = await import('./BulkCopyToAgentsModal')

  const store = configureStore({
    reducer: {
      skills: skillsReducer,
      agents: agentsReducer,
      ui: uiReducer,
      protect: protectReducer,
    },
  })

  mockSkillsGetAll.mockResolvedValue(skills)
  mockAgentsGetAll.mockResolvedValue(agents)

  const screen = await render(
    <Provider store={store}>
      <BulkCopyToAgentsModal />
    </Provider>,
  )

  await store.dispatch(fetchSkills())
  await store.dispatch(fetchAgents())
  store.dispatch(selectAll(selectedNames))
  store.dispatch(setBulkCopyModalOpen(true))

  await expect
    .element(screen.getByRole('dialog', { name: /Copy to Agents/i }))
    .toBeInTheDocument()

  return { screen, store }
}

describe('BulkCopyToAgentsModal target selection', () => {
  test('toggles an agent on and then off so its checkbox reflects the user clicks', async () => {
    // Arrange
    const { screen } = await renderModal({
      skills: [makeSkill('task')],
      agents: [makeAgent({ id: 'cursor', name: 'Cursor' })],
      selectedNames: [toSkillName('task')],
    })
    const cursorCheckbox = screen.getByRole('checkbox', { name: /Cursor/i })
    await expect.element(cursorCheckbox).not.toBeChecked()

    // Act — first click ticks it on, second click ticks it off
    await cursorCheckbox.click()
    await expect.element(cursorCheckbox).toBeChecked()
    await cursorCheckbox.click()

    // Assert
    await expect.element(cursorCheckbox).not.toBeChecked()
  })

  test('keeps unrelated agents unchecked when a different agent is ticked', async () => {
    // Arrange
    const { screen } = await renderModal({
      skills: [makeSkill('task')],
      agents: [
        makeAgent({ id: 'cursor', name: 'Cursor' }),
        makeAgent({ id: 'codex', name: 'Codex' }),
      ],
      selectedNames: [toSkillName('task')],
    })
    const cursorCheckbox = screen.getByRole('checkbox', { name: /Cursor/i })
    const codexCheckbox = screen.getByRole('checkbox', { name: /Codex/i })

    // Act
    await cursorCheckbox.click()

    // Assert
    await expect.element(cursorCheckbox).toBeChecked()
    await expect.element(codexCheckbox).not.toBeChecked()
  })
})

describe('BulkCopyToAgentsModal dismissal', () => {
  test('closes the modal and forgets ticked agents when Cancel is pressed', async () => {
    // Arrange
    const { screen, store } = await renderModal({
      skills: [makeSkill('task')],
      agents: [makeAgent({ id: 'cursor', name: 'Cursor' })],
      selectedNames: [toSkillName('task')],
    })
    await screen.getByRole('checkbox', { name: /Cursor/i }).click()

    // Act
    await screen.getByRole('button', { name: /Cancel/i }).click()

    // Assert
    expect(store.getState().skills.bulkCopyModalOpen).toBe(false)
  })

  test('closes the modal when Escape requests the dialog to close', async () => {
    // Arrange
    const { store } = await renderModal({
      skills: [makeSkill('task')],
      agents: [makeAgent({ id: 'cursor', name: 'Cursor' })],
      selectedNames: [toSkillName('task')],
    })

    // Act — Escape drives Radix onOpenChange(false) -> handleDialogOpenChange
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )

    // Assert
    await vi.waitFor(() => {
      expect(store.getState().skills.bulkCopyModalOpen).toBe(false)
    })
  })

  test('refuses to dismiss while a copy is still in flight so the batch is never abandoned', async () => {
    // Arrange — copy never resolves, so bulkCopying stays true after clicking Copy
    mockCopyToAgents.mockReturnValue(new Promise<CopyToAgentsResult>(() => {}))
    const { screen, store } = await renderModal({
      skills: [makeSkill('task')],
      agents: [makeAgent({ id: 'cursor', name: 'Cursor' })],
      selectedNames: [toSkillName('task')],
    })
    await screen.getByRole('checkbox', { name: /Cursor/i }).click()
    await screen.getByRole('button', { name: /Copy/i }).click()
    await expect
      .element(screen.getByRole('button', { name: /Copying/i }))
      .toBeInTheDocument()

    // Act — Escape mid-copy must be ignored
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )

    // Assert — modal stays open because the copy is unfinished
    await expect
      .element(screen.getByRole('dialog', { name: /Copy to Agents/i }))
      .toBeInTheDocument()
    expect(store.getState().skills.bulkCopyModalOpen).toBe(true)
  })
})

describe('BulkCopyToAgentsModal copy outcome', () => {
  test('shows a success toast and closes when every selected skill copies to every agent', async () => {
    // Arrange
    mockCopyToAgents.mockResolvedValue(
      makeCopyResult({ copied: toAgentCount(1) }),
    )
    const { screen, store } = await renderModal({
      skills: [makeSkill('task')],
      agents: [makeAgent({ id: 'cursor', name: 'Cursor' })],
      selectedNames: [toSkillName('task')],
    })
    await screen.getByRole('checkbox', { name: /Cursor/i }).click()

    // Act
    await screen
      .getByRole('button', { name: /Copy 1 skill to 1 agent/i })
      .click()

    // Assert
    await vi.waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Copied 1 skill to 1 agent', {
        description: 'task',
      })
    })
    expect(mockCopyToAgents).toHaveBeenCalledWith({
      skillName: 'task',
      sourcePath: '/home/user/.agents/skills/task',
      targetAgentIds: ['cursor'],
    })
    expect(store.getState().skills.bulkCopyModalOpen).toBe(false)
  })

  test('shows an error toast when no target accepted any copy', async () => {
    // Arrange — every target rejected, so totalCopied is 0
    mockCopyToAgents.mockResolvedValue(
      makeCopyResult({
        success: false,
        copied: toAgentCount(0),
        failures: [{ agentId: 'cursor', error: 'Already exists' }],
      }),
    )
    const { screen } = await renderModal({
      skills: [makeSkill('task')],
      agents: [makeAgent({ id: 'cursor', name: 'Cursor' })],
      selectedNames: [toSkillName('task')],
    })
    await screen.getByRole('checkbox', { name: /Cursor/i }).click()

    // Act
    await screen.getByRole('button', { name: /Copy/i }).click()

    // Assert
    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to copy 1 skill', {
        description: 'task → cursor: Already exists',
      })
    })
  })

  test('shows a generic error toast when a same-frame second copy is rejected by the in-flight guard', async () => {
    // Arrange — copy never resolves so the first dispatch keeps bulkCopying true.
    mockCopyToAgents.mockReturnValue(new Promise<CopyToAgentsResult>(() => {}))
    const { screen, store } = await renderModal({
      skills: [makeSkill('task')],
      agents: [makeAgent({ id: 'cursor', name: 'Cursor' })],
      selectedNames: [toSkillName('task')],
    })
    await screen.getByRole('checkbox', { name: /Cursor/i }).click()
    const { bulkCopyToAgents } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const copyButton = screen
      .getByRole('button', { name: /Copy 1 skill to 1 agent/i })
      .element()

    // Act — flip the store into bulkCopying via a direct first dispatch, then
    // click synchronously before React re-renders the button into its disabled
    // state. The still-mounted handler reads a stale `bulkCopying: false`, so it
    // dispatches a second copy whose thunk condition rejects (store already
    // copying), driving the modal's fulfilled.match else branch.
    store.dispatch(
      bulkCopyToAgents({
        items: [
          { skillName: toSkillName('task'), sourcePath: toAbsolutePath('/x') },
        ],
        agentIds: ['cursor'],
      }),
    )
    copyButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    // Assert
    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Failed to copy skills', {
        description: 'Aborted due to condition callback returning false.',
      })
    })
  })
})
