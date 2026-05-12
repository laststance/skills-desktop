import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { AgentId, SyncPreviewResult } from '@/shared/types'

const mockSyncPreview = vi.fn()
const mockSyncExecute = vi.fn()

const SCOPED_PREVIEW: SyncPreviewResult = {
  totalSkills: 4,
  totalAgents: 1,
  toCreate: 2,
  alreadySynced: 2,
  conflicts: [],
  forAgent: 'claude-code',
}

beforeEach(() => {
  mockSyncPreview.mockReset()
  mockSyncPreview.mockResolvedValue(SCOPED_PREVIEW)
  mockSyncExecute.mockReset()
  mockSyncExecute.mockResolvedValue({ details: [] })
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
  it('stays closed and skips preview when no agent target is active', async () => {
    const store = await createStore()
    const { CleanupAgentDialog } = await import('./CleanupAgentDialog')

    const screen = await render(
      <Provider store={store}>
        <CleanupAgentDialog />
      </Provider>,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockSyncPreview).toHaveBeenCalledTimes(0)
    expect(screen.getByText(/Cleanup missing skills/i).query()).toBeNull()
    expect(
      screen.getByRole('button', { name: /Cleanup \d+ skills/ }).query(),
    ).toBeNull()
  })

  it('opens from the closed state without changing the hook order', async () => {
    const { screen } = await renderClosedThenOpen('claude-code')

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
})
