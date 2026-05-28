import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { Agent, Skill, SkillName, SymlinkInfo } from '@/shared/types'

const mockGetSkills = vi.fn()
const mockGetAgents = vi.fn()
const mockGetSourceStats = vi.fn()
const mockClearOrphanSymlinks = vi.fn()
const mockClearBrokenSymlinkSlots = vi.fn()

vi.stubGlobal('electron', {
  skills: {
    getAll: mockGetSkills,
    clearOrphanSymlinks: mockClearOrphanSymlinks,
    clearBrokenSymlinkSlots: mockClearBrokenSymlinkSlots,
  },
  agents: {
    getAll: mockGetAgents,
  },
  source: {
    getStats: mockGetSourceStats,
  },
})

const TEST_AGENTS: Agent[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    path: '/Users/test/.cursor/skills',
    exists: true,
    skillCount: 0,
    localSkillCount: 0,
  },
  {
    id: 'codex',
    name: 'Codex',
    path: '/Users/test/.codex/skills',
    exists: true,
    skillCount: 0,
    localSkillCount: 0,
  },
]

/**
 * Builds one broken symlink slot for SymlinkCleanupDialog browser specs.
 * @param skillName - Skill name and agent-side link name.
 * @param agentId - Agent that owns the broken slot.
 * @returns SymlinkInfo fixture eligible for cleanup.
 * @example
 * makeBrokenSlot('task', 'cursor').status // => 'broken'
 */
function makeBrokenSlot(
  skillName: SkillName,
  agentId: 'cursor' | 'codex',
  overrides: Partial<SymlinkInfo> = {},
): SymlinkInfo {
  const agent = TEST_AGENTS.find((item) => item.id === agentId)
  if (!agent) throw new Error(`Unknown test agent: ${agentId}`)
  return {
    agentId,
    agentName: agent.name,
    status: 'broken',
    linkPath:
      overrides.linkPath ?? `/Users/test/.${agentId}/skills/${skillName}`,
    targetPath:
      overrides.targetPath ?? `/Users/test/.agents/skills/${skillName}`,
    isLocal: false,
    ...overrides,
  }
}

/**
 * Builds a source skill with one cleanup-eligible broken slot.
 * @param skillName - Skill and link name.
 * @param agentId - Agent that owns the broken slot.
 * @returns Skill fixture for the scanner thunk mock.
 * @example
 * makeSkillWithBrokenSlot('task', 'cursor').symlinks.length // => 1
 */
function makeSkillWithBrokenSlot(
  skillName: SkillName,
  agentId: 'cursor' | 'codex',
  symlinkOverrides: Partial<SymlinkInfo> = {},
): Skill {
  return {
    name: skillName,
    description: `${skillName} description`,
    path: `/Users/test/.agents/skills/${skillName}`,
    symlinkCount: 0,
    symlinks: [makeBrokenSlot(skillName, agentId, symlinkOverrides)],
    isSource: true,
    isOrphan: false,
  }
}

/**
 * Builds one source skill with multiple cleanup-eligible broken agent slots.
 * @param skillName - Shared basename used by every broken slot.
 * @param agentIds - Agents that own broken links for the same skill.
 * @returns Skill fixture whose rows differ by agent identity, not skill name.
 * @example
 * makeSkillWithBrokenSlots('task', ['cursor', 'codex']).symlinks.length // => 2
 */
function makeSkillWithBrokenSlots(
  skillName: SkillName,
  agentIds: Array<'cursor' | 'codex'>,
): Skill {
  return {
    ...makeSkillWithBrokenSlot(skillName, agentIds[0] ?? 'cursor'),
    symlinks: agentIds.map((agentId) => makeBrokenSlot(skillName, agentId)),
    symlinkCount: agentIds.length,
  }
}

/**
 * Builds an orphan skill record with one broken agent symlink.
 * @param skillName - Orphan skill name selected for cleanup.
 * @param agentId - Agent that still owns the dangling symlink.
 * @returns Skill fixture whose cleanup uses orphan-only IPC.
 * @example
 * makeOrphanSkill('abandoned', 'codex').isOrphan // => true
 */
function makeOrphanSkill(
  skillName: SkillName,
  agentId: 'cursor' | 'codex',
): Skill {
  return {
    ...makeSkillWithBrokenSlot(skillName, agentId),
    path: `/Users/test/.${agentId}/skills/${skillName}`,
    isSource: false,
    isOrphan: true,
  }
}

/**
 * Renders an opened SymlinkCleanupDialog with real reducers and mocked preload IPC.
 * @returns Browser screen for interaction assertions.
 * @example
 * const screen = await renderOpenedDialog()
 */
async function renderOpenedDialog() {
  const [
    { default: skillsReducer },
    { default: agentsReducer },
    { default: uiReducer, openSymlinkCleanupDialog },
    { SymlinkCleanupDialog },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('@/renderer/src/redux/slices/uiSlice'),
    import('./SymlinkCleanupDialog'),
  ])
  const store = configureStore({
    reducer: { skills: skillsReducer, agents: agentsReducer, ui: uiReducer },
  })
  store.dispatch(openSymlinkCleanupDialog())

  const screen = await render(
    <Provider store={store}>
      <main id="main-content" tabIndex={-1}>
        <button type="button" data-symlink-cleanup-trigger="true">
          Scan issues
        </button>
        <SymlinkCleanupDialog />
      </main>
    </Provider>,
  )
  return screen
}

describe('SymlinkCleanupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAgents.mockResolvedValue(TEST_AGENTS)
    mockGetSourceStats.mockResolvedValue({
      skillCount: 0,
      totalSize: '0 B',
      path: '/Users/test/.agents/skills',
      lastModified: '2026-05-28T00:00:00.000Z',
    })
  })

  it('shows a rescan affordance after an initial scan failure', async () => {
    // Arrange
    mockGetSkills
      .mockRejectedValueOnce(new Error('Transient scanner failure'))
      .mockResolvedValueOnce([makeSkillWithBrokenSlot('retry-task', 'cursor')])
    const screen = await renderOpenedDialog()

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Rescan' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Rescan' }).click()

    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await expect
      .element(screen.getByText('retry-task', { exact: true }))
      .toBeVisible()
  })

  it('stops cleanup when the fresh scan no longer matches the reviewed plan', async () => {
    // Arrange
    mockGetSkills
      .mockResolvedValueOnce([makeSkillWithBrokenSlot('stale-task', 'cursor')])
      .mockResolvedValueOnce([])
    const screen = await renderOpenedDialog()

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()

    // Assert
    await expect
      .element(screen.getByText('Plan changed', { exact: true }))
      .toBeVisible()
    expect(mockClearOrphanSymlinks).not.toHaveBeenCalled()
    expect(mockClearBrokenSymlinkSlots).not.toHaveBeenCalled()
  })

  it('stops cleanup when a same-id broken slot points at a new target', async () => {
    // Arrange
    mockGetSkills
      .mockResolvedValueOnce([makeSkillWithBrokenSlot('stale-task', 'cursor')])
      .mockResolvedValueOnce([
        makeSkillWithBrokenSlot('stale-task', 'cursor', {
          targetPath: '/Users/test/.agents/skills/other-target',
        }),
      ])
    const screen = await renderOpenedDialog()

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()

    // Assert
    await expect
      .element(screen.getByText('Plan changed', { exact: true }))
      .toBeVisible()
    expect(mockClearOrphanSymlinks).not.toHaveBeenCalled()
    expect(mockClearBrokenSymlinkSlots).not.toHaveBeenCalled()
  })

  it('keeps only failed rows selected after partial unlink failure refreshes the plan', async () => {
    // Arrange
    const firstPlan = [
      makeSkillWithBrokenSlot('fixed-task', 'cursor'),
      makeSkillWithBrokenSlot('failed-task', 'codex'),
    ]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce([makeSkillWithBrokenSlot('failed-task', 'codex')])
    mockClearBrokenSymlinkSlots.mockImplementation(
      async (options: {
        items: Array<{ agentId: string; linkName: string; linkPath: string }>
      }) => {
        return {
          items: options.items.map((item) => {
            if (item.agentId === 'cursor') {
              return {
                agentId: item.agentId,
                skillName: item.linkName,
                linkPath: item.linkPath,
                outcome: 'unlinked',
              }
            }
            return {
              agentId: item.agentId,
              skillName: item.linkName,
              linkPath: item.linkPath,
              outcome: 'error',
              error: { message: 'Permission denied', code: 'EACCES' },
            }
          }),
        }
      },
    )
    const screen = await renderOpenedDialog()

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Clean 2 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 2 selected' }).click()

    // Assert
    await expect
      .element(screen.getByText('Cleanup finished with failures.'))
      .toBeVisible()
    await expect.element(screen.getByText('Permission denied')).toBeVisible()
    expect(screen.getByText('fixed-task', { exact: true }).query()).toBeNull()
    await expect
      .element(screen.getByText('failed-task', { exact: true }))
      .toBeVisible()
  })

  it('keeps cleanup success when post-cleanup refresh fails', async () => {
    // Arrange
    const firstPlan = [makeSkillWithBrokenSlot('refresh-failed-task', 'cursor')]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    mockGetAgents
      .mockRejectedValueOnce(new Error('Dashboard refresh offline'))
      .mockRejectedValueOnce(new Error('Dashboard refresh still offline'))
    mockClearBrokenSymlinkSlots.mockResolvedValue({
      items: [
        {
          agentId: 'cursor',
          skillName: 'refresh-failed-task',
          linkPath: '/Users/test/.cursor/skills/refresh-failed-task',
          outcome: 'unlinked',
        },
      ],
    })
    const screen = await renderOpenedDialog()

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()

    // Assert
    await expect
      .element(screen.getByText(/Cleaned up 1 symlink issue/))
      .toBeVisible()
    await expect
      .element(screen.getByText(/Refresh failed after cleanup/))
      .toBeVisible()
    await expect
      .element(
        screen.getByText(
          'Cleanup succeeded. Rescan to refresh the dashboard state.',
        ),
      )
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Rescan' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Rescan' }).click()
    await expect.poll(() => mockGetAgents.mock.calls.length).toBe(2)
    await expect.poll(() => mockGetSourceStats.mock.calls.length).toBe(2)
    await expect
      .element(screen.getByText('No safe cleanup items'))
      .toBeVisible()
    await expect
      .element(screen.getByText(/Dashboard refresh still offline/))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Rescan' }))
      .toBeVisible()
    expect(screen.getByText(/Cleanup failed/).query()).toBeNull()
  })

  it('keeps dashboard refresh warnings when rescan finds more cleanup items', async () => {
    // Arrange
    const firstPlan = [makeSkillWithBrokenSlot('refresh-ready-task', 'cursor')]
    const nextPlan = [makeSkillWithBrokenSlot('next-refresh-task', 'codex')]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(nextPlan)
      .mockResolvedValueOnce(nextPlan)
    mockGetAgents
      .mockRejectedValueOnce(new Error('Dashboard refresh offline'))
      .mockRejectedValueOnce(new Error('Dashboard refresh still offline'))
    mockClearBrokenSymlinkSlots.mockResolvedValue({
      items: [
        {
          agentId: 'cursor',
          skillName: 'refresh-ready-task',
          linkPath: '/Users/test/.cursor/skills/refresh-ready-task',
          outcome: 'unlinked',
        },
      ],
    })
    const screen = await renderOpenedDialog()

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()
    await expect
      .element(screen.getByRole('button', { name: 'Rescan' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Rescan' }).click()

    // Assert
    await expect
      .element(screen.getByText('next-refresh-task', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await expect
      .element(screen.getByText(/Dashboard refresh still offline/))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Rescan' }))
      .toBeVisible()
  })

  it('requires rescan when a failed row keeps its id but changes target after cleanup', async () => {
    // Arrange
    const firstPlan = [makeSkillWithBrokenSlot('failed-task', 'codex')]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce([
        makeSkillWithBrokenSlot('failed-task', 'codex', {
          targetPath: '/Users/test/.agents/skills/other-failed-target',
        }),
      ])
    mockClearBrokenSymlinkSlots.mockResolvedValue({
      items: [
        {
          agentId: 'codex',
          skillName: 'failed-task',
          linkPath: '/Users/test/.codex/skills/failed-task',
          outcome: 'error',
          error: { message: 'Permission denied', code: 'EACCES' },
        },
      ],
    })
    const screen = await renderOpenedDialog()

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()

    // Assert
    await expect
      .element(screen.getByText('Cleanup result changed. Rescan required.'))
      .toBeVisible()
    expect(
      screen.getByText('Cleanup finished with failures.').query(),
    ).toBeNull()
    expect(screen.getByText('Permission denied').query()).toBeNull()
  })

  it('keeps same-name broken slot failures attached to the failed agent row', async () => {
    // Arrange
    const firstPlan = [
      makeSkillWithBrokenSlots('shared-task', ['cursor', 'codex']),
    ]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce([makeSkillWithBrokenSlot('shared-task', 'codex')])
    mockClearBrokenSymlinkSlots.mockImplementation(
      async (options: {
        items: Array<{ agentId: string; linkName: string; linkPath: string }>
      }) => ({
        items: options.items.map((item) =>
          item.agentId === 'cursor'
            ? {
                agentId: item.agentId,
                skillName: item.linkName,
                linkPath: item.linkPath,
                outcome: 'unlinked',
              }
            : {
                agentId: item.agentId,
                skillName: item.linkName,
                linkPath: item.linkPath,
                outcome: 'error',
                error: { message: 'Codex permission denied', code: 'EACCES' },
              },
        ),
      }),
    )
    const screen = await renderOpenedDialog()

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Clean 2 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 2 selected' }).click()

    // Assert
    await expect
      .element(screen.getByText('Cleanup finished with failures.'))
      .toBeVisible()
    await expect
      .element(screen.getByText('Codex permission denied'))
      .toBeVisible()
    await expect
      .element(screen.getByText('Codex', { exact: true }))
      .toBeVisible()
    expect(screen.getByText('Cursor', { exact: true }).query()).toBeNull()
  })

  it('renders the cleaning phase while destructive IPC is pending', async () => {
    // Arrange
    let finishCleanup: (value: {
      items: Array<{
        agentId: string
        skillName: string
        linkPath: string
        outcome: 'unlinked'
      }>
    }) => void = () => undefined
    const firstPlan = [makeSkillWithBrokenSlot('pending-task', 'cursor')]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce([])
    mockClearBrokenSymlinkSlots.mockImplementation(async () => {
      return new Promise((resolve) => {
        finishCleanup = resolve
      })
    })
    const screen = await renderOpenedDialog()

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()

    // Assert
    await expect
      .element(screen.getByText('Cleaning selected issues'))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Cleaning...' }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('button', { name: 'Cancel' }))
      .toBeDisabled()
    expect(screen.getByRole('button', { name: /^Close$/i }).query()).toBeNull()

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    )
    await expect
      .element(screen.getByText('Cleaning selected issues'))
      .toBeVisible()

    finishCleanup({
      items: [
        {
          agentId: 'cursor',
          skillName: 'pending-task',
          linkPath: '/Users/test/.cursor/skills/pending-task',
          outcome: 'unlinked',
        },
      ],
    })
    await expect
      .element(screen.getByText(/Cleaned up 1 symlink issue/))
      .toBeVisible()
  })

  it('surfaces orphan-only IPC failures without calling source delete', async () => {
    // Arrange
    const orphanPlan = [makeOrphanSkill('abandoned-task', 'codex')]
    mockGetSkills
      .mockResolvedValueOnce(orphanPlan)
      .mockResolvedValueOnce(orphanPlan)
      .mockResolvedValueOnce(orphanPlan)
    mockClearOrphanSymlinks.mockResolvedValue({
      items: [
        {
          skillName: 'abandoned-task',
          outcome: 'error',
          error: {
            message: 'Source skill exists. Rescan before cleanup.',
            code: 'ESTALE',
          },
        },
      ],
    })
    const screen = await renderOpenedDialog()

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()

    // Assert
    await expect
      .element(screen.getByText('Cleanup finished with failures.'))
      .toBeVisible()
    await expect
      .element(screen.getByText('Source skill exists. Rescan before cleanup.'))
      .toBeVisible()
    await expect
      .element(
        screen.getByText(
          'Codex: /Users/test/.codex/skills/abandoned-task -> /Users/test/.agents/skills/abandoned-task',
        ),
      )
      .toBeVisible()
    expect(mockClearOrphanSymlinks).toHaveBeenCalledWith({
      items: [
        {
          skillName: 'abandoned-task',
          agents: [
            {
              agentId: 'codex',
              linkPath: '/Users/test/.codex/skills/abandoned-task',
              targetPath: '/Users/test/.agents/skills/abandoned-task',
            },
          ],
        },
      ],
    })
  })

  it('shows link-folder identity before metadata name for broken cleanup rows', async () => {
    // Arrange
    const mismatchPlan = [
      makeSkillWithBrokenSlot('metadata-title', 'cursor', {
        linkPath: '/Users/test/.cursor/skills/link-folder-name',
        targetPath: '/Users/test/.agents/skills/missing-target',
      }),
    ]
    mockGetSkills
      .mockResolvedValueOnce(mismatchPlan)
      .mockResolvedValueOnce(mismatchPlan)
      .mockResolvedValueOnce([])
    mockClearBrokenSymlinkSlots.mockResolvedValue({
      items: [
        {
          agentId: 'cursor',
          skillName: 'link-folder-name',
          linkPath: '/Users/test/.cursor/skills/link-folder-name',
          outcome: 'unlinked',
        },
      ],
    })

    // Act
    const screen = await renderOpenedDialog()

    // Assert
    await expect
      .element(screen.getByText('link-folder-name (metadata-title)'))
      .toBeVisible()
    await expect
      .element(
        screen.getByText(
          '/Users/test/.cursor/skills/link-folder-name -> /Users/test/.agents/skills/missing-target',
        ),
      )
      .toBeVisible()
    await expect
      .element(
        screen.getByRole('checkbox', {
          name: 'Clean broken link for link-folder-name (metadata-title) from Cursor',
        }),
      )
      .toBeInTheDocument()
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()

    // Assert: the destructive IPC uses the reviewed folder name and paths, not
    // the metadata display name that happens to own the row in scanner output.
    await expect
      .poll(() => mockClearBrokenSymlinkSlots.mock.calls.length)
      .toBe(1)
    expect(mockClearBrokenSymlinkSlots).toHaveBeenCalledWith({
      items: [
        {
          agentId: 'cursor',
          linkName: 'link-folder-name',
          linkPath: '/Users/test/.cursor/skills/link-folder-name',
          targetPath: '/Users/test/.agents/skills/missing-target',
        },
      ],
    })
    await expect
      .element(screen.getByText(/Cleaned up 1 symlink issue/))
      .toBeVisible()
  })
})
