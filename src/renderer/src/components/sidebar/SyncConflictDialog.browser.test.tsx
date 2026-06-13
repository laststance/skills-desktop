import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { SyncExecuteResult, SyncPreviewResult } from '@/shared/types'

const mockSyncExecute = vi.fn()

const CONFLICT_CLAUDE = {
  skillName: 'tdd-workflow',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  agentSkillPath: '/Users/me/.claude/skills/tdd-workflow',
} as const

const CONFLICT_CURSOR = {
  skillName: 'theme-generator',
  agentId: 'cursor',
  agentName: 'Cursor',
  agentSkillPath: '/Users/me/.cursor/skills/theme-generator',
} as const

const GLOBAL_PREVIEW_WITH_CONFLICTS: SyncPreviewResult = {
  totalSkills: 5,
  totalAgents: 3,
  toCreate: 8,
  alreadySynced: 2,
  conflicts: [CONFLICT_CLAUDE, CONFLICT_CURSOR],
}

const SCOPED_PREVIEW_WITH_CONFLICTS: SyncPreviewResult = {
  totalSkills: 5,
  totalAgents: 1,
  toCreate: 4,
  alreadySynced: 1,
  conflicts: [CONFLICT_CLAUDE],
  forAgent: 'claude-code',
}

const EXECUTE_RESULT: SyncExecuteResult = {
  success: true,
  created: 8,
  replaced: 2,
  skipped: 0,
  errors: [],
  details: [],
}

beforeEach(() => {
  mockSyncExecute.mockReset()
  mockSyncExecute.mockResolvedValue(EXECUTE_RESULT)
  // Browser mode replaces Electron's preload bridge, so install the sync IPC
  // surface that SyncConflictDialog reaches through executeSyncAction.
  vi.stubGlobal('electron', {
    sync: {
      execute: mockSyncExecute,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build the smallest Redux store SyncConflictDialog needs.
 * @param preview - Seed value for `ui.syncPreview` controlling open/closed.
 * @returns Store with the ui slice preloaded so the dialog opens immediately.
 * @example
 * const store = await createStore(GLOBAL_PREVIEW_WITH_CONFLICTS)
 */
async function createStore(preview: SyncPreviewResult | null) {
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const store = configureStore({ reducer: { ui: uiReducer } })
  if (preview) {
    const { setSyncPreview } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(setSyncPreview(preview))
  }
  return store
}

/**
 * Renders the dialog wired to a store seeded with the given preview.
 * @param preview - Preview to seed; null keeps the dialog closed.
 * @returns The rendered browser screen and backing store.
 * @example
 * const { screen } = await renderWithPreview(GLOBAL_PREVIEW_WITH_CONFLICTS)
 */
async function renderWithPreview(preview: SyncPreviewResult | null) {
  const store = await createStore(preview)
  const { SyncConflictDialog } = await import('./SyncConflictDialog')

  const screen = await render(
    <Provider store={store}>
      <SyncConflictDialog />
    </Provider>,
  )

  return { screen, store }
}

describe('SyncConflictDialog', () => {
  it('stays hidden when the sync preview carries no conflicts', async () => {
    // Arrange + Act
    const { screen } = await renderWithPreview(null)

    // Assert
    expect(screen.getByText('Sync Conflicts').query()).toBeNull()
  })

  it('stays hidden when a conflict preview is scoped to a single agent', async () => {
    // Arrange + Act — a forAgent preview belongs to CleanupAgentDialog, not here.
    const { screen } = await renderWithPreview(SCOPED_PREVIEW_WITH_CONFLICTS)

    // Assert
    expect(screen.getByText('Sync Conflicts').query()).toBeNull()
  })

  it('opens listing every global conflict with its skill and agent name', async () => {
    // Arrange + Act
    const { screen } = await renderWithPreview(GLOBAL_PREVIEW_WITH_CONFLICTS)

    // Assert
    await expect.element(screen.getByText('Sync Conflicts')).toBeVisible()
    await expect
      .element(
        screen.getByText(
          '2 local folder(s) found where symlinks would be created. Select which to replace with symlinks.',
        ),
      )
      .toBeVisible()
    await expect.element(screen.getByText('tdd-workflow')).toBeVisible()
    await expect.element(screen.getByText('theme-generator')).toBeVisible()
    await expect.element(screen.getByText('in Claude Code')).toBeVisible()
    await expect.element(screen.getByText('in Cursor')).toBeVisible()
  })

  it('relabels the skip button to "unselected" once a conflict is ticked and back when unticked', async () => {
    // Arrange
    const { screen } = await renderWithPreview(GLOBAL_PREVIEW_WITH_CONFLICTS)
    await expect
      .element(screen.getByRole('button', { name: 'Skip all conflicts' }))
      .toBeVisible()
    const checkboxes = screen.getByRole('checkbox')

    // Act — tick the first conflict to add it to the selection set.
    await checkboxes.first().click()

    // Assert — selection present, so the button offers to skip the unselected.
    await expect
      .element(screen.getByRole('button', { name: 'Skip unselected' }))
      .toBeVisible()

    // Act — untick the same conflict to remove it from the selection set.
    await checkboxes.first().click()

    // Assert — selection empty again, so the button reverts to skip-all.
    await expect
      .element(screen.getByRole('button', { name: 'Skip all conflicts' }))
      .toBeVisible()
  })

  it('replaces every conflict folder when "Replace all" is pressed', async () => {
    // Arrange
    const { screen } = await renderWithPreview(GLOBAL_PREVIEW_WITH_CONFLICTS)

    // Act
    await screen.getByRole('button', { name: 'Replace all' }).click()

    // Assert — execute receives the absolute paths of all conflicts.
    await expect
      .poll(() => mockSyncExecute.mock.calls.length)
      .toBeGreaterThan(0)
    expect(mockSyncExecute).toHaveBeenCalledWith({
      replaceConflicts: [
        '/Users/me/.claude/skills/tdd-workflow',
        '/Users/me/.cursor/skills/theme-generator',
      ],
    })
  })

  it('replaces only the ticked conflicts when "Skip unselected" is pressed', async () => {
    // Arrange
    const { screen } = await renderWithPreview(GLOBAL_PREVIEW_WITH_CONFLICTS)
    await screen.getByRole('checkbox').first().click()
    await expect
      .element(screen.getByRole('button', { name: 'Skip unselected' }))
      .toBeVisible()

    // Act
    await screen.getByRole('button', { name: 'Skip unselected' }).click()

    // Assert — only the single ticked path is sent for replacement.
    await expect
      .poll(() => mockSyncExecute.mock.calls.length)
      .toBeGreaterThan(0)
    expect(mockSyncExecute).toHaveBeenCalledWith({
      replaceConflicts: ['/Users/me/.claude/skills/tdd-workflow'],
    })
  })

  it('clears the dialog when the user dismisses it with Escape', async () => {
    // Arrange
    const { screen, store } = await renderWithPreview(
      GLOBAL_PREVIEW_WITH_CONFLICTS,
    )
    await expect.element(screen.getByText('Sync Conflicts')).toBeVisible()

    // Act — Escape triggers Radix onOpenChange → handleClose → setSyncPreview(null).
    await userPressEscape(screen)

    // Assert
    await expect.poll(() => store.getState().ui.syncPreview).toBeNull()
    expect(screen.getByText('Sync Conflicts').query()).toBeNull()
  })
})

/**
 * Presses Escape on the focused dialog to drive Radix's close path.
 * @param screen - The rendered browser screen owning the dialog DOM.
 * @example await userPressEscape(screen)
 */
async function userPressEscape(
  screen: Awaited<ReturnType<typeof render>>,
): Promise<void> {
  const dialog = screen.getByRole('dialog').element()
  if (dialog instanceof HTMLElement) dialog.focus()
  dialog.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )
}
