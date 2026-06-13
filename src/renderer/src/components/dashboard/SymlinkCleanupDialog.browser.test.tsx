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
 * @returns Browser screen and Redux store for interaction assertions.
 * @example
 * const { screen, store } = await renderOpenedDialogWithStore()
 */
async function renderOpenedDialogWithStore() {
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
  return { screen, store }
}

/**
 * Renders an opened cleanup dialog and returns only the browser screen.
 * @returns Browser screen for tests that do not inspect Redux state.
 * @example
 * const screen = await renderOpenedDialog()
 */
async function renderOpenedDialog() {
  const { screen } = await renderOpenedDialogWithStore()
  return screen
}

/**
 * Fires a native click on a Radix checkbox so its onCheckedChange runs in the
 * browser lane, where the locator click skips zero-size unchecked checkboxes.
 * @param element - Checkbox button element resolved from a locator.
 * @returns Nothing; the click toggles selection via the real change handler.
 * @example
 * toggleCheckbox(rowCheckbox.element())
 */
function toggleCheckbox(element: Element): void {
  if (!(element instanceof HTMLElement)) {
    throw new Error('Expected a checkbox HTMLElement')
  }
  element.click()
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

  it('shows destructive path evidence as a readable inspection block', async () => {
    // Arrange
    const destructivePath =
      '/Users/test/.cursor/skills/readable-task -> /Users/test/.agents/skills/readable-task'
    mockGetSkills.mockResolvedValueOnce([
      makeSkillWithBrokenSlot('readable-task', 'cursor'),
    ])

    // Act
    const screen = await renderOpenedDialog()

    // Assert
    const pathText = screen.getByText(destructivePath)
    await expect.element(pathText).toBeVisible()
    const evidence = pathText
      .element()
      .closest('[data-testid="cleanup-path-evidence"]')
    expect(evidence).toBeInstanceOf(HTMLElement)
    const evidenceElement = evidence as HTMLElement
    expect(evidenceElement.className).toContain('text-xs')
    expect(evidenceElement.className).toContain('bg-muted/30')
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
    const selectedSkillName = 'stale-list-row' as SkillName
    const { screen, store } = await renderOpenedDialogWithStore()
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(toggleSelection(selectedSkillName))
    expect(store.getState().skills.selectedSkillNames).toEqual([
      selectedSkillName,
    ])

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
    expect(store.getState().skills.selectedSkillNames).toEqual([])
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

  it('requires rescan when a row fails and the post-cleanup skills refresh rejects', async () => {
    // Arrange — open scan + pre-clean fetch succeed; the post-cleanup
    // fetchSkills (the plan source) rejects so no post-cleanup plan exists.
    const firstPlan = [makeSkillWithBrokenSlot('refresh-reject-task', 'codex')]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockRejectedValueOnce(new Error('Scanner offline after cleanup'))
    mockClearBrokenSymlinkSlots.mockResolvedValue({
      items: [
        {
          agentId: 'codex',
          skillName: 'refresh-reject-task',
          linkPath: '/Users/test/.codex/skills/refresh-reject-task',
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

    // Assert — the failed branch cannot recompute visibility without a fresh
    // plan, so it asks for an explicit rescan instead of rendering row errors.
    await expect
      .element(
        screen.getByText(
          'Cleanup finished with failures, but the refresh failed. Rescan required.',
        ),
      )
      .toBeVisible()
    expect(
      screen.getByText('Cleanup finished with failures.').query(),
    ).toBeNull()
    expect(screen.getByText('Permission denied').query()).toBeNull()
  })

  it('refreshes every dashboard source when rescanning after a post-mutation stale prompt', async () => {
    // Arrange — the cleanup row fails AND the post-cleanup fetchSkills rejects,
    // so the dialog lands in the post-mutation 'stale' prompt. The rescan's
    // fetchSkills then resolves a fresh plan, but the agent registry is offline
    // only on that rescan: its warning surfaces solely if the rescan refreshes
    // every dashboard source, which a pre-mutation stale rescan never does.
    const firstPlan = [makeSkillWithBrokenSlot('stale-refresh-task', 'codex')]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockRejectedValueOnce(new Error('Scanner offline after cleanup'))
      .mockResolvedValueOnce(firstPlan)
    mockGetAgents
      .mockResolvedValueOnce(TEST_AGENTS)
      .mockRejectedValueOnce(new Error('Agent registry offline on rescan'))
    mockClearBrokenSymlinkSlots.mockResolvedValue({
      items: [
        {
          agentId: 'codex',
          skillName: 'stale-refresh-task',
          linkPath: '/Users/test/.codex/skills/stale-refresh-task',
          outcome: 'error',
          error: { message: 'Permission denied', code: 'EACCES' },
        },
      ],
    })
    const screen = await renderOpenedDialog()

    // Act — clean (lands in the post-mutation stale prompt), then rescan.
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()
    await expect
      .element(
        screen.getByText(
          'Cleanup finished with failures, but the refresh failed. Rescan required.',
        ),
      )
      .toBeVisible()
    await screen.getByRole('button', { name: 'Rescan' }).click()

    // Assert — the rescan re-fetched every dashboard source: the source stats
    // aggregate (fetched once on cleanup, once on rescan) and the agent registry
    // (whose offline warning then appears; a skills-only rescan would show
    // neither).
    await expect.poll(() => mockGetSourceStats.mock.calls.length).toBe(2)
    await expect
      .element(screen.getByText(/Agent registry offline on rescan/))
      .toBeVisible()
  })

  it('refreshes every dashboard source when rescanning after a post-mutation cleanup error', async () => {
    // Arrange — the cleanup row fails AND a post-cleanup dashboard refresh (the
    // agent registry) rejects, but the post-cleanup fetchSkills resolves with
    // the failed row still present, so the dialog lands in the post-mutation
    // 'error' phase carrying a refresh-failure summary (not a stale prompt). The
    // rescan's agent registry is offline only on that rescan: its warning
    // surfaces solely if the rescan refreshes every dashboard source, which the
    // error phase does only because its summary records the post-cleanup
    // refresh failure.
    const firstPlan = [makeSkillWithBrokenSlot('error-refresh-task', 'codex')]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
    mockGetAgents
      .mockRejectedValueOnce(new Error('Dashboard offline after cleanup'))
      .mockRejectedValueOnce(new Error('Agent registry offline on rescan'))
    mockClearBrokenSymlinkSlots.mockResolvedValue({
      items: [
        {
          agentId: 'codex',
          skillName: 'error-refresh-task',
          linkPath: '/Users/test/.codex/skills/error-refresh-task',
          outcome: 'error',
          error: { message: 'Permission denied', code: 'EACCES' },
        },
      ],
    })
    const screen = await renderOpenedDialog()

    // Act — clean (lands in the post-mutation error phase), then rescan.
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()
    await expect
      .element(screen.getByText('Cleanup finished with failures.'))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Rescan' }).click()

    // Assert — the rescan re-fetched every dashboard source: the source stats
    // aggregate (fetched once on cleanup, once on rescan) and the agent registry
    // (whose offline warning then appears; before the error-phase fix the rescan
    // re-fetched skills only and showed neither).
    await expect.poll(() => mockGetSourceStats.mock.calls.length).toBe(2)
    await expect
      .element(screen.getByText(/Agent registry offline on rescan/))
      .toBeVisible()
  })

  it('keeps cleanup success when only the post-cleanup skills refresh rejects', async () => {
    // Arrange — same fetchSkills rejection, but the cleanup row succeeds, so
    // the happy path must still report completion (not a stale rescan prompt).
    const firstPlan = [makeSkillWithBrokenSlot('refresh-reject-ok', 'codex')]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockRejectedValueOnce(new Error('Scanner offline after cleanup'))
    mockClearBrokenSymlinkSlots.mockResolvedValue({
      items: [
        {
          agentId: 'codex',
          skillName: 'refresh-reject-ok',
          linkPath: '/Users/test/.codex/skills/refresh-reject-ok',
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

    // Assert — completion summary with a refresh warning, never the stale guard.
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
    expect(
      screen
        .getByText(
          'Cleanup finished with failures, but the refresh failed. Rescan required.',
        )
        .query(),
    ).toBeNull()
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

  it('clears stale Installed-list selection when dashboard cleanup starts', async () => {
    // Arrange
    const selectedSkillName = 'stale-list-row' as SkillName
    const cleanupPlan = [
      makeSkillWithBrokenSlot('dialog-cleanup-task', 'cursor'),
    ]
    mockGetSkills
      .mockResolvedValueOnce(cleanupPlan)
      .mockResolvedValueOnce(cleanupPlan)
      .mockResolvedValueOnce(cleanupPlan)
    mockClearBrokenSymlinkSlots.mockResolvedValue({
      items: [
        {
          agentId: 'cursor',
          skillName: 'dialog-cleanup-task',
          linkPath: '/Users/test/.cursor/skills/dialog-cleanup-task',
          outcome: 'unlinked',
        },
      ],
    })
    const { screen, store } = await renderOpenedDialogWithStore()
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(toggleSelection(selectedSkillName))
    expect(store.getState().skills.selectedSkillNames).toEqual([
      selectedSkillName,
    ])

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()

    // Assert
    await expect
      .poll(() => mockClearBrokenSymlinkSlots.mock.calls.length)
      .toBe(1)
    expect(store.getState().skills.selectedSkillNames).toEqual([])
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

  it('reports an unhelpful scanner failure as a generic scan error', async () => {
    // Arrange — the scanner rejects with a plain object carrying no message,
    // which RTK serializes to a non-Error, non-string value without a string
    // message, so the dialog falls back to its generic copy.
    mockGetSkills.mockRejectedValueOnce({ code: 'ENOSCAN' })

    // Act
    const screen = await renderOpenedDialog()

    // Assert
    await expect
      .element(screen.getByText('Scan failed: Unknown error'))
      .toBeVisible()
  })

  it('closes the dialog and discards the reviewed plan when cancelled', async () => {
    // Arrange
    mockGetSkills.mockResolvedValueOnce([
      makeSkillWithBrokenSlot('cancel-task', 'cursor'),
    ])
    const { screen, store } = await renderOpenedDialogWithStore()
    await expect
      .element(screen.getByText('cancel-task', { exact: true }))
      .toBeVisible()

    // Act
    await screen.getByRole('button', { name: 'Cancel' }).click()

    // Assert — the dialog unmounts and its open flag is cleared.
    await expect
      .poll(() => store.getState().ui.symlinkCleanupDialogOpen)
      .toBe(false)
    expect(screen.getByText('Symlink cleanup').query()).toBeNull()
  })

  it('deselects then reselects a single row from its row checkbox', async () => {
    // Arrange
    mockGetSkills.mockResolvedValueOnce([
      makeSkillWithBrokenSlot('toggle-task', 'cursor'),
    ])
    const screen = await renderOpenedDialog()
    const rowCheckbox = screen.getByRole('checkbox', {
      name: 'Clean broken link for toggle-task from Cursor',
    })
    await expect.element(rowCheckbox).toBeChecked()

    // Act — uncheck the only row.
    toggleCheckbox(rowCheckbox.element())

    // Assert — unchecking the last row leaves zero selected.
    await expect
      .element(screen.getByRole('button', { name: 'Clean 0 selected' }))
      .toBeDisabled()
    await expect.element(rowCheckbox).not.toBeChecked()

    // Act — re-check the same row.
    toggleCheckbox(rowCheckbox.element())

    // Assert — rechecking restores the selectable count.
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await expect.element(rowCheckbox).toBeChecked()
  })

  it('clears then restores every row in a section from the section checkbox', async () => {
    // Arrange — two broken rows share one "Broken agent links" section.
    mockGetSkills.mockResolvedValueOnce([
      makeSkillWithBrokenSlot('section-a', 'cursor'),
      makeSkillWithBrokenSlot('section-b', 'codex'),
    ])
    const screen = await renderOpenedDialog()
    const rowA = screen.getByRole('checkbox', {
      name: 'Clean broken link for section-a from Cursor',
    })
    const sectionCheckbox = screen.getByRole('checkbox', {
      name: 'Select all Broken agent links',
    })
    await expect
      .element(screen.getByRole('button', { name: 'Clean 2 selected' }))
      .toBeVisible()

    // Act — drop one row so the section header becomes a partial selection.
    toggleCheckbox(rowA.element())
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()

    // Act — the partial section checkbox selects every row in the section.
    toggleCheckbox(sectionCheckbox.element())

    // Assert — a partial "select all" promotes the section to fully selected.
    await expect
      .element(screen.getByRole('button', { name: 'Clean 2 selected' }))
      .toBeVisible()

    // Act — the now-full section checkbox clears every row in the section.
    toggleCheckbox(sectionCheckbox.element())

    // Assert — clearing the section drops the selection to zero.
    await expect
      .element(screen.getByRole('button', { name: 'Clean 0 selected' }))
      .toBeDisabled()
  })

  it('reports a scan error when the post-cleanup rescan re-fetch rejects', async () => {
    // Arrange — cleanup succeeds but its dashboard refresh fails, landing in a
    // complete-with-rescan state. The rescan then refreshes every source, and
    // its fetchSkills rejection must surface as a scan error (not a silent
    // swallow) because the full-refresh scan re-throws the skills rejection.
    const firstPlan = [makeSkillWithBrokenSlot('rescan-reject-task', 'cursor')]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Scanner offline on rescan'))
    mockGetAgents.mockRejectedValueOnce(
      new Error('Dashboard refresh offline after cleanup'),
    )
    mockClearBrokenSymlinkSlots.mockResolvedValue({
      items: [
        {
          agentId: 'cursor',
          skillName: 'rescan-reject-task',
          linkPath: '/Users/test/.cursor/skills/rescan-reject-task',
          outcome: 'unlinked',
        },
      ],
    })
    const screen = await renderOpenedDialog()

    // Act — clean (lands in complete-needs-rescan), then rescan.
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()
    await expect
      .element(screen.getByRole('button', { name: 'Rescan' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Rescan' }).click()

    // Assert
    await expect
      .element(screen.getByText('Scan failed: Scanner offline on rescan'))
      .toBeVisible()
  })

  it('attaches multiple same-agent unlink results to one agent row', async () => {
    // Arrange — two skills both have a broken slot on Cursor, so the unlink IPC
    // returns two Cursor results that must collapse into a single agent group.
    const firstPlan = [
      makeSkillWithBrokenSlot('grouped-a', 'cursor'),
      makeSkillWithBrokenSlot('grouped-b', 'cursor'),
    ]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce([])
    mockClearBrokenSymlinkSlots.mockImplementation(
      async (options: {
        items: Array<{ agentId: string; linkName: string; linkPath: string }>
      }) => ({
        items: options.items.map((item) => ({
          agentId: item.agentId,
          skillName: item.linkName,
          linkPath: item.linkPath,
          outcome: 'unlinked',
        })),
      }),
    )
    const screen = await renderOpenedDialog()

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Clean 2 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 2 selected' }).click()

    // Assert — both Cursor unlinks roll up into the same summary line.
    await expect
      .element(screen.getByText(/Cleaned up 2 symlink issues/))
      .toBeVisible()
    await expect
      .element(screen.getByText(/2 broken agent links unlinked/))
      .toBeVisible()
  })

  it('reports a cleanup failure when the destructive IPC itself rejects', async () => {
    // Arrange — the unlink IPC throws instead of returning per-row outcomes, so
    // the executor's catch path must still refresh the dashboard and surface a
    // generic cleanup error.
    const firstPlan = [makeSkillWithBrokenSlot('throwing-task', 'cursor')]
    mockGetSkills
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce(firstPlan)
      .mockResolvedValueOnce([])
    mockClearBrokenSymlinkSlots.mockRejectedValueOnce(
      new Error('Unlink IPC crashed'),
    )
    const screen = await renderOpenedDialog()

    // Act
    await expect
      .element(screen.getByRole('button', { name: 'Clean 1 selected' }))
      .toBeVisible()
    await screen.getByRole('button', { name: 'Clean 1 selected' }).click()

    // Assert — the catch path re-fetches skills and shows the failure copy.
    await expect
      .element(screen.getByText('Cleanup failed: Unlink IPC crashed'))
      .toBeVisible()
    await expect.poll(() => mockGetSkills.mock.calls.length).toBe(3)
  })
})
