import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { SyncExecuteResult } from '@/shared/types'

const mockSkillsGetAll = vi.fn()
const mockAgentsGetAll = vi.fn()
const mockSourceGetStats = vi.fn()

const RESULT_WITH_CHANGES: SyncExecuteResult = {
  success: true,
  created: 2,
  replaced: 1,
  skipped: 1,
  errors: [{ path: '/Users/me/.codex/skills/broken', error: 'EACCES' }],
  // One row per action so each badge label appears exactly once. The summary
  // counts above are independent of these rows (they drive the header + chips).
  details: [
    { skillName: 'tdd-workflow', agentName: 'Claude Code', action: 'created' },
    { skillName: 'commit-helper', agentName: 'Codex', action: 'replaced' },
    {
      skillName: 'already-there',
      agentName: 'Devin Desktop',
      action: 'skipped',
    },
    {
      skillName: 'broken',
      agentName: 'Codex',
      action: 'error',
      error: 'EACCES',
    },
  ],
}

const RESULT_NO_CHANGES: SyncExecuteResult = {
  success: true,
  created: 0,
  replaced: 0,
  skipped: 3,
  errors: [],
  details: [
    { skillName: 'already-a', agentName: 'Claude Code', action: 'skipped' },
    { skillName: 'already-b', agentName: 'Cursor', action: 'skipped' },
    { skillName: 'already-c', agentName: 'Codex', action: 'skipped' },
  ],
}

const RESULT_EMPTY_DETAILS: SyncExecuteResult = {
  success: true,
  created: 0,
  replaced: 0,
  skipped: 0,
  errors: [],
  details: [],
}

beforeEach(() => {
  mockSkillsGetAll.mockReset()
  mockAgentsGetAll.mockReset()
  mockSourceGetStats.mockReset()
  mockSkillsGetAll.mockResolvedValue([])
  mockAgentsGetAll.mockResolvedValue([])
  mockSourceGetStats.mockResolvedValue(null)
  // Browser mode replaces Electron's preload bridge. The Close handler triggers
  // refreshAllData, which fans out to skills/agents/source IPC — stub the
  // electron global (window === globalThis in browser mode) so the post-close
  // refresh resolves instead of throwing on an undefined bridge.
  vi.stubGlobal('electron', {
    skills: { getAll: mockSkillsGetAll },
    agents: { getAll: mockAgentsGetAll },
    source: { getStats: mockSourceGetStats },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Seed `ui.syncResult` and render the dialog wired to a full root store.
 * Seeding via `executeSyncAction.fulfilled` mirrors how the real app populates
 * the result (no setSyncResult reducer exists). skills/agents reducers are
 * included so the Close→refreshAllData fan-out has slices to land on.
 * @param syncResult - Result to seed; null keeps the dialog closed.
 * @returns The rendered browser screen and backing store.
 * @example const { screen } = await renderWithResult(RESULT_WITH_CHANGES)
 */
async function renderWithResult(syncResult: SyncExecuteResult | null) {
  const [
    { default: uiReducer, executeSyncAction },
    { default: skillsReducer },
    { default: agentsReducer },
    { SyncResultDialog },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/uiSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('./SyncResultDialog'),
  ])
  const store = configureStore({
    reducer: { ui: uiReducer, skills: skillsReducer, agents: agentsReducer },
  })
  if (syncResult) {
    store.dispatch(
      executeSyncAction.fulfilled(syncResult, 'req-sync', {
        replaceConflicts: [],
      }),
    )
  }

  const screen = await render(
    <Provider store={store}>
      <SyncResultDialog />
    </Provider>,
  )
  return { screen, store }
}

describe('SyncResultDialog', () => {
  it('stays hidden until a sync has actually produced a result', async () => {
    // Arrange + Act — no result seeded, so the dialog must render nothing.
    const { screen } = await renderWithResult(null)

    // Assert
    expect(screen.getByText('Sync Results').query()).toBeNull()
  })

  it('opens with a header summary once a sync result is available', async () => {
    // Arrange + Act
    const { screen } = await renderWithResult(RESULT_WITH_CHANGES)

    // Assert — header plus the derived "partial" summary line.
    await expect.element(screen.getByText('Sync Results')).toBeVisible()
    await expect
      .element(
        screen.getByText('Created 2 symlinks, Replaced 1 conflict, 1 failed'),
      )
      .toBeVisible()
  })

  it('shows a color-coded count chip for every nonzero outcome', async () => {
    // Arrange + Act
    const { screen } = await renderWithResult(RESULT_WITH_CHANGES)

    // Assert — each nonzero bucket surfaces its own chip.
    await expect.element(screen.getByText('2 created')).toBeVisible()
    await expect.element(screen.getByText('1 replaced')).toBeVisible()
    await expect.element(screen.getByText('1 errors')).toBeVisible()
    await expect.element(screen.getByText('1 skipped')).toBeVisible()
  })

  it('lists each processed row with its action badge and skill→agent labels', async () => {
    // Arrange + Act
    const { screen } = await renderWithResult(RESULT_WITH_CHANGES)

    // Assert — badge labels come from ACTION_LABEL (exact match so the summary
    // line and count chips, which share substrings, don't collide), names from
    // each detail row.
    await expect
      .element(screen.getByText('Created', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('Replaced', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('Skipped', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('Error', { exact: true }))
      .toBeVisible()
    await expect.element(screen.getByText('tdd-workflow')).toBeVisible()
    await expect.element(screen.getByText('commit-helper')).toBeVisible()
  })

  it('surfaces the failure message on an errored row', async () => {
    // Arrange + Act — an error row must render its `error` string inline.
    const { screen } = await renderWithResult(RESULT_WITH_CHANGES)

    // Assert
    await expect.element(screen.getByText('EACCES')).toBeVisible()
  })

  it('shows an empty-state line when no items were processed', async () => {
    // Arrange + Act — a result with zero detail rows.
    const { screen } = await renderWithResult(RESULT_EMPTY_DETAILS)

    // Assert
    await expect
      .element(screen.getByText('No items were processed.'))
      .toBeVisible()
  })

  it('refreshes app data after closing a result that changed the filesystem', async () => {
    // Arrange — a result with created/replaced/errors counts as "had changes".
    const { screen, store } = await renderWithResult(RESULT_WITH_CHANGES)
    await expect.element(screen.getByText('Sync Results')).toBeVisible()

    // Act — the footer Close button dismisses the dialog and triggers
    // refreshAllData. (Radix also renders an X with the name "Close"; the footer
    // button is first in DOM order so `.first()` selects the explicit one.)
    await screen.getByRole('button', { name: 'Close' }).first().click()

    // Assert — result cleared and the three refresh IPC calls fired.
    await expect.poll(() => store.getState().ui.syncResult).toBeNull()
    await expect.poll(() => mockSkillsGetAll.mock.calls.length).toBe(1)
    expect(mockAgentsGetAll).toHaveBeenCalledTimes(1)
    expect(mockSourceGetStats).toHaveBeenCalledTimes(1)
  })

  it('skips the data refresh when closing a result that changed nothing', async () => {
    // Arrange — an all-skipped result has no changes, so no refresh should run.
    const { screen, store } = await renderWithResult(RESULT_NO_CHANGES)
    await expect.element(screen.getByText('Sync Results')).toBeVisible()

    // Act — click the footer Close button (first in DOM order).
    await screen.getByRole('button', { name: 'Close' }).first().click()

    // Assert — dialog cleared but the refresh fan-out never fired.
    await expect.poll(() => store.getState().ui.syncResult).toBeNull()
    expect(mockSkillsGetAll).not.toHaveBeenCalled()
    expect(mockAgentsGetAll).not.toHaveBeenCalled()
    expect(mockSourceGetStats).not.toHaveBeenCalled()
  })
})
