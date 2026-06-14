import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { Agent, Skill, SkillName, SymlinkInfo } from '@/shared/types'

const mockCopyToAgents = vi.fn()
const mockGetAll = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockOnDeleteProgress = vi.fn(() => () => {})

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

/**
 * Build a minimal agent fixture for Copy modal tests.
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
 * Build a minimal skill fixture for Copy modal tests.
 * @param symlinks - Source/target entries attached to the skill.
 * @returns Complete Skill object.
 * @example
 * makeSkill([])
 */
function makeSkill(symlinks: SymlinkInfo[]): Skill {
  return {
    name: 'task' as SkillName,
    description: 'Task management skill',
    path: '/home/user/.agents/skills/task',
    symlinkCount: symlinks.length,
    symlinks,
    isSource: true,
    isOrphan: false,
  }
}

beforeEach(() => {
  mockCopyToAgents.mockReset()
  mockGetAll.mockReset()
  mockAgentsGetAll.mockReset()

  mockGetAll.mockResolvedValue([])
  mockAgentsGetAll.mockResolvedValue([])

  vi.stubGlobal('electron', {
    skills: {
      copyToAgents: mockCopyToAgents,
      getAll: mockGetAll,
      onDeleteProgress: mockOnDeleteProgress,
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
 * Render the Copy modal with a real reducer store.
 * @param options.skill - Skill opened in the modal.
 * @param options.agents - Agent rows returned by the mocked IPC bridge.
 * @param options.selectedAgentId - Current Agent View source agent.
 * @returns Render handle and Redux store.
 */
async function renderModal(options: {
  skill: Skill
  agents: Agent[]
  selectedAgentId: Agent['id']
}) {
  const { skill, agents, selectedAgentId } = options
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { CopyToAgentsModal } = await import('./CopyToAgentsModal')
  const { fetchAgents } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { setSkillToCopy } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')

  const store = configureStore({
    reducer: {
      skills: skillsReducer,
      agents: agentsReducer,
      ui: uiReducer,
    },
  })

  mockAgentsGetAll.mockResolvedValue(agents)

  const screen = await render(
    <Provider store={store}>
      <CopyToAgentsModal />
    </Provider>,
  )

  await store.dispatch(fetchAgents())
  store.dispatch(selectAgent(selectedAgentId))
  store.dispatch(setSkillToCopy(skill))

  await expect
    .element(screen.getByRole('dialog', { name: /Copy to Agents/i }))
    .toBeInTheDocument()

  return { screen, store }
}

describe('CopyToAgentsModal source guards', () => {
  it('disables copy actions when the selected source is a broken symlink', async () => {
    // Arrange
    const skill = makeSkill([
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        status: 'broken',
        targetPath: '/home/user/.agents/skills/task',
        linkPath: '/home/user/.claude/skills/task',
        isLocal: false,
      },
    ])

    // Act
    const { screen } = await renderModal({
      skill,
      agents: [
        makeAgent({ id: 'claude-code', name: 'Claude Code' }),
        makeAgent({ id: 'cursor', name: 'Cursor' }),
      ],
      selectedAgentId: 'claude-code',
    })

    // Assert
    await expect
      .element(screen.getByText(/selected source is unavailable/i))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('checkbox', { name: /Cursor/i }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('button', { name: /Copy to 0 agent\(s\)/i }))
      .toBeDisabled()

    expect(mockCopyToAgents).not.toHaveBeenCalled()
  })

  it('keeps copy actions enabled when the selected source is a valid linked skill', async () => {
    // Arrange
    const skill = makeSkill([
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        status: 'valid',
        targetPath: '/home/user/.agents/skills/task',
        linkPath: '/home/user/.claude/skills/task',
        isLocal: false,
      },
    ])

    // Act
    const { screen } = await renderModal({
      skill,
      agents: [
        makeAgent({ id: 'claude-code', name: 'Claude Code' }),
        makeAgent({ id: 'cursor', name: 'Cursor' }),
      ],
      selectedAgentId: 'claude-code',
    })

    // Assert — a valid source resolves a usable source path, so the unavailable
    // warning never appears and the destination checkbox stays selectable
    await expect
      .element(screen.getByRole('checkbox', { name: /Cursor/i }))
      .not.toBeDisabled()
    expect(screen.container.textContent).not.toContain(
      'selected source is unavailable',
    )
  })
})

describe('CopyToAgentsModal destination selection', () => {
  it('marks a destination agent as chosen when its row is clicked', async () => {
    // Arrange
    const skill = makeSkill([
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        status: 'valid',
        targetPath: '/home/user/.agents/skills/task',
        linkPath: '/home/user/.claude/skills/task',
        isLocal: false,
      },
    ])
    const { screen, store } = await renderModal({
      skill,
      agents: [
        makeAgent({ id: 'claude-code', name: 'Claude Code' }),
        makeAgent({ id: 'cursor', name: 'Cursor' }),
      ],
      selectedAgentId: 'claude-code',
    })
    const cursorCheckbox = screen.getByRole('checkbox', { name: /Cursor/i })

    // Act
    await cursorCheckbox.click()

    // Assert
    await expect.element(cursorCheckbox).toBeChecked()
    expect(store.getState().skills.selectedCopyAgentIds).toContain('cursor')
  })
})

describe('CopyToAgentsModal copy outcome', () => {
  it('copies the source skill to every ticked agent when Copy is pressed', async () => {
    // Arrange
    mockCopyToAgents.mockResolvedValue({
      success: true,
      copied: 1,
      failures: [],
    })
    const skill = makeSkill([
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        status: 'valid',
        targetPath: '/home/user/.agents/skills/task',
        linkPath: '/home/user/.claude/skills/task',
        isLocal: false,
      },
    ])
    const { screen } = await renderModal({
      skill,
      agents: [
        makeAgent({ id: 'claude-code', name: 'Claude Code' }),
        makeAgent({ id: 'cursor', name: 'Cursor' }),
      ],
      selectedAgentId: 'claude-code',
    })
    await screen.getByRole('checkbox', { name: /Cursor/i }).click()

    // Act
    await screen.getByRole('button', { name: /Copy to 1 agent\(s\)/i }).click()

    // Assert — the copy IPC receives the resolved source path and ticked target
    await vi.waitFor(() => {
      expect(mockCopyToAgents).toHaveBeenCalledWith({
        skillName: 'task',
        sourcePath: '/home/user/.claude/skills/task',
        targetAgentIds: ['cursor'],
      })
    })
  })
})

describe('CopyToAgentsModal dismissal', () => {
  it('closes the modal when Cancel is pressed', async () => {
    // Arrange
    const skill = makeSkill([
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        status: 'valid',
        targetPath: '/home/user/.agents/skills/task',
        linkPath: '/home/user/.claude/skills/task',
        isLocal: false,
      },
    ])
    const { screen, store } = await renderModal({
      skill,
      agents: [
        makeAgent({ id: 'claude-code', name: 'Claude Code' }),
        makeAgent({ id: 'cursor', name: 'Cursor' }),
      ],
      selectedAgentId: 'claude-code',
    })

    // Act
    await screen.getByRole('button', { name: /Cancel/i }).click()

    // Assert — clearing skillToCopy is what collapses the dialog
    await vi.waitFor(() => {
      expect(store.getState().skills.skillToCopy).toBeNull()
    })
  })

  it('closes the modal when Escape requests the dialog to close', async () => {
    // Arrange
    const skill = makeSkill([
      {
        agentId: 'claude-code',
        agentName: 'Claude Code',
        status: 'valid',
        targetPath: '/home/user/.agents/skills/task',
        linkPath: '/home/user/.claude/skills/task',
        isLocal: false,
      },
    ])
    const { store } = await renderModal({
      skill,
      agents: [
        makeAgent({ id: 'claude-code', name: 'Claude Code' }),
        makeAgent({ id: 'cursor', name: 'Cursor' }),
      ],
      selectedAgentId: 'claude-code',
    })

    // Act — Escape drives Radix onOpenChange(false) -> handleOpenChange
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )

    // Assert
    await vi.waitFor(() => {
      expect(store.getState().skills.skillToCopy).toBeNull()
    })
  })
})
