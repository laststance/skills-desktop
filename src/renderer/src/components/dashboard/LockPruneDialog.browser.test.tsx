import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'

const mockPruneLockEntries = vi.fn()
const mockScanStaleLockEntries = vi.fn()
const mockGetSkills = vi.fn()
const mockGetAgents = vi.fn()
const mockGetSourceStats = vi.fn()

vi.stubGlobal('electron', {
  skills: {
    getAll: mockGetSkills,
    pruneLockEntries: mockPruneLockEntries,
    scanStaleLockEntries: mockScanStaleLockEntries,
  },
  agents: { getAll: mockGetAgents },
  source: { getStats: mockGetSourceStats },
})

/**
 * Render the prune confirmation with the dialog already open and the given
 * stale records seeded, matching what the HealthWidget CTA produces.
 * @param staleLockNames - Records the user is being asked to confirm.
 * @returns Browser screen and store.
 * @example const { screen } = await renderDialog(['old-skill'])
 */
async function renderDialog(staleLockNames: string[]) {
  const [
    { default: skillLockReducer, fetchStaleLockEntries },
    { default: uiReducer, openLockPruneDialog },
    { LockPruneDialog },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/skillLockSlice'),
    import('@/renderer/src/redux/slices/uiSlice'),
    import('./LockPruneDialog'),
  ])
  const store = configureStore({
    reducer: { skillLock: skillLockReducer, ui: uiReducer },
  })
  store.dispatch(
    fetchStaleLockEntries.fulfilled(
      { status: 'ok', names: staleLockNames },
      'req-lock',
      undefined,
    ),
  )
  store.dispatch(openLockPruneDialog())

  const screen = await render(
    <Provider store={store}>
      <LockPruneDialog />
    </Provider>,
  )
  return { screen, store }
}

beforeEach(() => {
  mockPruneLockEntries.mockReset()
  mockScanStaleLockEntries.mockReset()
  mockScanStaleLockEntries.mockResolvedValue({ status: 'ok', names: [] })
})

describe('LockPruneDialog', () => {
  it('names every record it is about to remove, with no per-item choice', async () => {
    // Arrange — each listed record points at a skill that is already gone, so
    // there is nothing meaningful to select between.
    const { screen } = await renderDialog(['old-skill', 'another-skill'])

    // Assert
    await expect.element(screen.getByText('old-skill')).toBeVisible()
    await expect.element(screen.getByText('another-skill')).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Remove 2 records' }))
      .toBeVisible()
  })

  it('sends the confirmed records to main and closes on success', async () => {
    // Arrange
    mockPruneLockEntries.mockResolvedValue({
      pruned: ['old-skill'],
      skipped: [],
      failed: [],
    })
    const { screen, store } = await renderDialog(['old-skill'])

    // Act
    await screen.getByRole('button', { name: 'Remove 1 record' }).click()

    // Assert
    expect(mockPruneLockEntries).toHaveBeenCalledWith({ names: ['old-skill'] })
    await vi.waitFor(() => {
      expect(store.getState().ui.lockPruneDialogOpen).toBe(false)
    })
  })

  it('keeps a record that survived removal in the stale list', async () => {
    // Arrange — `skills remove` exits 0 even when a removal failed, so main
    // reports survivors and the widget has to keep offering them.
    mockPruneLockEntries.mockResolvedValue({
      pruned: [],
      skipped: [],
      failed: ['stubborn'],
    })
    mockScanStaleLockEntries.mockResolvedValue({
      status: 'ok',
      names: ['stubborn'],
    })
    const { screen, store } = await renderDialog(['stubborn'])

    // Act
    await screen.getByRole('button', { name: 'Remove 1 record' }).click()

    // Assert
    await vi.waitFor(() => {
      expect(store.getState().skillLock.staleNames).toEqual(['stubborn'])
    })
  })

  it('closes without touching the lock when the user cancels', async () => {
    // Arrange
    const { screen, store } = await renderDialog(['old-skill'])

    // Act
    await screen.getByRole('button', { name: 'Cancel' }).click()

    // Assert
    expect(mockPruneLockEntries).not.toHaveBeenCalled()
    expect(store.getState().ui.lockPruneDialogOpen).toBe(false)
  })
})
