import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { SyncExecuteResult, SyncPreviewResult } from '@/shared/types'

const mockSyncExecute = vi.fn()

// A global, conflict-free preview with new work to do: this is exactly the
// shape that makes shouldShowSyncConfirm return true (toCreate > 0, no
// conflicts, no forAgent), so the confirm dialog opens.
const PREVIEW_READY_TO_SYNC: SyncPreviewResult = {
  totalSkills: 5,
  totalAgents: 3,
  toCreate: 8,
  alreadySynced: 2,
  conflicts: [],
}

// A scoped (forAgent) preview belongs to CleanupAgentDialog, not the global
// confirm dialog — used to prove this dialog stays closed for it.
const SCOPED_PREVIEW: SyncPreviewResult = {
  totalSkills: 5,
  totalAgents: 1,
  toCreate: 4,
  alreadySynced: 1,
  conflicts: [],
  forAgent: 'cursor',
}

const EXECUTE_RESULT: SyncExecuteResult = {
  success: true,
  created: 8,
  replaced: 0,
  skipped: 2,
  errors: [],
  details: [],
}

beforeEach(() => {
  mockSyncExecute.mockReset()
  mockSyncExecute.mockResolvedValue(EXECUTE_RESULT)
  // Browser mode replaces Electron's preload bridge, so install the sync IPC
  // surface that SyncConfirmDialog reaches through executeSyncAction.
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
 * Renders SyncConfirmDialog wired to a ui-only store seeded with the preview.
 * @param preview - Preview to seed `ui.syncPreview`; null keeps the dialog closed.
 * @returns The rendered browser screen and backing store.
 * @example const { screen } = await renderWithPreview(PREVIEW_READY_TO_SYNC)
 */
async function renderWithPreview(preview: SyncPreviewResult | null) {
  const { default: uiReducer, setSyncPreview } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const store = configureStore({ reducer: { ui: uiReducer } })
  if (preview) {
    store.dispatch(setSyncPreview(preview))
  }
  const { SyncConfirmDialog } = await import('./SyncConfirmDialog')

  const screen = await render(
    <Provider store={store}>
      <SyncConfirmDialog />
    </Provider>,
  )
  return { screen, store }
}

describe('SyncConfirmDialog', () => {
  it('stays hidden when there is no sync preview to confirm', async () => {
    // Arrange + Act — nothing seeded, so the dialog renders nothing.
    const { screen } = await renderWithPreview(null)

    // Assert
    expect(screen.getByText('Sync Skills').query()).toBeNull()
  })

  it('stays hidden when the preview is scoped to a single agent', async () => {
    // Arrange + Act — a forAgent preview belongs to CleanupAgentDialog, not here.
    const { screen } = await renderWithPreview(SCOPED_PREVIEW)

    // Assert
    expect(screen.getByText('Sync Skills').query()).toBeNull()
  })

  it('opens with the symlink counts when a conflict-free sync is pending', async () => {
    // Arrange + Act
    const { screen } = await renderWithPreview(PREVIEW_READY_TO_SYNC)

    // Assert — header plus the seeded skills/agents and to-create totals.
    await expect.element(screen.getByText('Sync Skills')).toBeVisible()
    await expect.element(screen.getByText('5 skills → 3 agents')).toBeVisible()
    await expect
      .element(screen.getByText('New symlinks to create'))
      .toBeVisible()
    await expect.element(screen.getByText('8')).toBeVisible()
  })

  it('shows the already-synced count when some symlinks are in place', async () => {
    // Arrange + Act — alreadySynced > 0 must surface its own stat row.
    const { screen } = await renderWithPreview(PREVIEW_READY_TO_SYNC)

    // Assert
    await expect.element(screen.getByText('Already synced')).toBeVisible()
    await expect.element(screen.getByText('2')).toBeVisible()
  })

  it('clears the pending preview when the user cancels', async () => {
    // Arrange
    const { screen, store } = await renderWithPreview(PREVIEW_READY_TO_SYNC)
    await expect.element(screen.getByText('Sync Skills')).toBeVisible()

    // Act — Cancel triggers handleClose → setSyncPreview(null).
    await screen.getByRole('button', { name: 'Cancel' }).click()

    // Assert — dialog dismissed and the preview wiped from state.
    await expect.poll(() => store.getState().ui.syncPreview).toBeNull()
    expect(screen.getByText('Sync Skills').query()).toBeNull()
  })

  it('dispatches a conflict-free sync and shows a spinner while it runs', async () => {
    // Arrange — a never-resolving execute keeps the dialog in its in-flight state
    // so the "Syncing..." spinner branch is observable.
    mockSyncExecute.mockReturnValue(new Promise<SyncExecuteResult>(() => {}))
    const { screen } = await renderWithPreview(PREVIEW_READY_TO_SYNC)
    await expect.element(screen.getByText('Sync Skills')).toBeVisible()

    // Act
    await screen.getByRole('button', { name: 'Sync' }).click()

    // Assert — execute fired with an empty conflict list and the spinner shows.
    await expect
      .poll(() => mockSyncExecute.mock.calls.length)
      .toBeGreaterThan(0)
    expect(mockSyncExecute).toHaveBeenCalledWith({ replaceConflicts: [] })
    await expect.element(screen.getByText('Syncing...')).toBeVisible()
  })
})
