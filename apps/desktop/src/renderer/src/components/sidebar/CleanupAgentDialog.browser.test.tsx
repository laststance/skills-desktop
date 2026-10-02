import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { AgentId, SyncPreviewResult } from '@/shared/types'
import { toAgentCount, toSkillCount, toSymlinkCount } from '@/shared/types'

const mockSyncPreview = vi.fn()
const mockSyncExecute = vi.fn()
const mockToastError = vi.fn()

// CleanupAgentDialog surfaces a `toast.error` when the scoped preview thunk
// rejects; mirror AgentDeleteDialog's sonner stub so that path is assertable.
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const SCOPED_PREVIEW: SyncPreviewResult = {
  totalSkills: toSkillCount(4),
  totalAgents: toAgentCount(1),
  toCreate: toSymlinkCount(2),
  alreadySynced: toSymlinkCount(2),
  conflicts: [],
  forAgent: 'claude-code',
}

beforeEach(() => {
  mockSyncPreview.mockReset()
  mockSyncPreview.mockResolvedValue(SCOPED_PREVIEW)
  mockSyncExecute.mockReset()
  mockSyncExecute.mockResolvedValue({ details: [] })
  mockToastError.mockReset()
  // Browser mode replaces Electron's preload bridge, so install the sync IPC
  // surface that CleanupAgentDialog reaches through the Redux thunks.
  vi.stubGlobal('electron', {
    sync: {
      preview: mockSyncPreview,
      execute: mockSyncExecute,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build the smallest Redux store CleanupAgentDialog needs.
 * @returns Store with the ui slice wired for preview target dispatches.
 * @example
 * const store = await createStore()
 * store.dispatch(setCleanupAgentTarget('claude-code'))
 */
async function createStore() {
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  return configureStore({
    reducer: { ui: uiReducer },
  })
}

/**
 * Opens the dialog through Redux after the component's first closed render.
 * This mirrors the production path where AgentItem sets cleanupAgentTarget
 * from a context-menu click after CleanupAgentDialog has already mounted.
 * @param agentId - Agent receiving the scoped cleanup preview.
 * @returns The rendered browser screen and backing store.
 * @example
 * const { screen } = await renderClosedThenOpen('claude-code')
 */
async function renderClosedThenOpen(agentId: AgentId) {
  const store = await createStore()
  const { CleanupAgentDialog } = await import('./CleanupAgentDialog')
  const { setCleanupAgentTarget } =
    await import('@/renderer/src/redux/slices/uiSlice')

  const screen = await render(
    <Provider store={store}>
      <CleanupAgentDialog />
    </Provider>,
  )

  // The crash video opened the dialog from an already-mounted, closed state.
  store.dispatch(setCleanupAgentTarget(agentId))

  return { screen, store }
}

describe('CleanupAgentDialog', () => {
  test('stays hidden and runs no preview when no cleanup target is set', async () => {
    // Arrange
    const store = await createStore()
    const { CleanupAgentDialog } = await import('./CleanupAgentDialog')

    // Act
    const screen = await render(
      <Provider store={store}>
        <CleanupAgentDialog />
      </Provider>,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Assert
    expect(mockSyncPreview).toHaveBeenCalledTimes(0)
    expect(screen.getByText(/Cleanup missing skills/i).query()).toBeNull()
    expect(
      screen.getByRole('button', { name: /Cleanup \d+ skills/ }).query(),
    ).toBeNull()
  })

  test('opens with the agent name, preview, and skill count when a target is set', async () => {
    // Arrange + Act
    const { screen } = await renderClosedThenOpen('claude-code')

    // Assert
    await expect
      .poll(() =>
        mockSyncPreview.mock.calls.some(
          ([options]) => options?.agentId === 'claude-code',
        ),
      )
      .toBe(true)
    await expect
      .element(screen.getByText(/Cleanup missing skills.*Claude Code/))
      .toBeInTheDocument()
    await expect.element(screen.getByText('Symlinks to create')).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Cleanup 2 skills' }))
      .toBeVisible()
  })

  test('warns and closes itself when the cleanup preview fails to load', async () => {
    // Arrange
    // A rejected scoped preview must not strand the user on the spinner; the
    // dialog has to surface a toast and dismiss so they can recover.
    mockSyncPreview.mockReset()
    mockSyncPreview.mockRejectedValue(new Error('preview offline'))

    // Act
    const { store } = await renderClosedThenOpen('claude-code')

    // Assert
    await expect.poll(() => mockToastError.mock.calls.length).toBeGreaterThan(0)
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to load cleanup preview',
      { description: expect.any(String) },
    )
    await expect.poll(() => store.getState().ui.cleanupAgentTarget).toBeNull()
  })

  test('recreates the missing symlinks and hands off to the result dialog on confirm', async () => {
    // Arrange
    const { screen, store } = await renderClosedThenOpen('claude-code')
    await expect
      .element(screen.getByRole('button', { name: 'Cleanup 2 skills' }))
      .toBeVisible()

    // Act
    await screen.getByRole('button', { name: 'Cleanup 2 skills' }).click()

    // Assert
    await expect
      .poll(() =>
        mockSyncExecute.mock.calls.some(
          ([options]) => options?.agentId === 'claude-code',
        ),
      )
      .toBe(true)
    // Success clears the target so SyncResultDialog becomes the lone surface.
    await expect.poll(() => store.getState().ui.cleanupAgentTarget).toBeNull()
  })

  test('dismisses without running cleanup when cancelled while idle', async () => {
    // Arrange
    const { screen, store } = await renderClosedThenOpen('claude-code')
    await expect
      .element(screen.getByRole('button', { name: 'Cancel' }))
      .toBeVisible()

    // Act
    await screen.getByRole('button', { name: 'Cancel' }).click()

    // Assert
    await expect.poll(() => store.getState().ui.cleanupAgentTarget).toBeNull()
    expect(mockSyncExecute).toHaveBeenCalledTimes(0)
  })
})

test('keeps the new agent dialog open when an obsolete preview fails after switching agents', async () => {
  // Arrange
  let rejectOlder!: (error: Error) => void
  const olderPreview = new Promise<SyncPreviewResult>((_, reject) => {
    rejectOlder = reject
  })
  mockSyncPreview.mockReturnValueOnce(olderPreview)
  const { screen, store } = await renderClosedThenOpen('claude-code')
  const { setCleanupAgentTarget } =
    await import('@/renderer/src/redux/slices/uiSlice')
  mockSyncPreview.mockResolvedValueOnce({
    ...SCOPED_PREVIEW,
    forAgent: 'cursor',
  })
  // Act
  store.dispatch(setCleanupAgentTarget('cursor'))
  await expect
    .element(screen.getByText('Cleanup missing skills — Cursor'))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Cleanup 2 skills' }))
    .toBeVisible()
  rejectOlder(new Error('obsolete agent preview'))
  await olderPreview.catch(() => undefined)
  // Allow the rejected thunk and component callback to settle before assertions.
  await new Promise((resolve) => setTimeout(resolve, 0))
  // Assert
  await expect.poll(() => store.getState().ui.isSyncing).toBe(false)
  expect(store.getState().ui.cleanupAgentTarget).toBe('cursor')
  expect(mockToastError).not.toHaveBeenCalled()
  await expect
    .element(screen.getByRole('button', { name: 'Cleanup 2 skills' }))
    .toBeVisible()
})

test('explains an unavailable agent instead of claiming that all its links are present', async () => {
  // Arrange
  mockSyncPreview.mockResolvedValue({
    ...SCOPED_PREVIEW,
    totalAgents: toAgentCount(0),
    toCreate: toSymlinkCount(0),
  })
  // Act
  const { screen } = await renderClosedThenOpen('claude-code')
  // Assert
  await expect
    .element(
      screen.getByText(
        'This agent is no longer available. Close and refresh the agent list.',
      ),
    )
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'Close', exact: true }).last())
    .toBeVisible()
})
