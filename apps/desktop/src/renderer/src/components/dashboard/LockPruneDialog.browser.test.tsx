import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { StaleLockScanResult } from '@/shared/types'
import { toSkillName } from '@/shared/types'

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockToastInfo = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
  },
}))

const mockPruneLockEntries = vi.fn()
// Typed against the real channel: an untyped `vi.fn()` let these fixtures drop
// a field the reducer then wrote as `undefined`, and the failure surfaced as a
// render crash in an unrelated test rather than here.
const mockScanStaleLockEntries = vi.fn<() => Promise<StaleLockScanResult>>()
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
async function renderDialog(
  staleLockNames: string[],
  unprunable: {
    name: string
    reason: 'name-collision' | 'agent-copy'
  }[] = [],
) {
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
  // `pending` first: the reducer only applies a scan result whose requestId is
  // the newest one it issued, so a bare `fulfilled` would be ignored.
  store.dispatch(fetchStaleLockEntries.pending('req-lock', undefined))
  store.dispatch(
    fetchStaleLockEntries.fulfilled(
      {
        status: 'ok',
        names: staleLockNames.map(toSkillName),
        unprunable: unprunable.map((entry) => ({
          ...entry,
          name: toSkillName(entry.name),
        })),
      },
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
  mockScanStaleLockEntries.mockResolvedValue({
    status: 'ok',
    names: [],
    unprunable: [],
  })
  mockToastSuccess.mockReset()
  mockToastError.mockReset()
  mockToastInfo.mockReset()
})

describe('LockPruneDialog', () => {
  test('names every record it is about to remove, with no per-item choice', async () => {
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

  test('sends the confirmed records to main and closes on success', async () => {
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

  test('keeps a record that survived removal in the stale list', async () => {
    // Arrange — `skills remove` exits 0 even when a removal failed, so main
    // reports survivors and the widget has to keep offering them.
    mockPruneLockEntries.mockResolvedValue({
      pruned: [],
      skipped: [],
      failed: ['stubborn'],
    })
    mockScanStaleLockEntries.mockResolvedValue({
      status: 'ok',
      names: [toSkillName('stubborn')],
      unprunable: [],
    })
    const { screen, store } = await renderDialog(['stubborn'])

    // Act
    await screen.getByRole('button', { name: 'Remove 1 record' }).click()

    // Assert
    await vi.waitFor(() => {
      expect(store.getState().skillLock.staleNames).toEqual(['stubborn'])
    })
  })

  test('closes the dialog instead of hanging open when the prune IPC itself fails', async () => {
    // Arrange — a rejected thunk (IPC down, zod refusing an arg, a main-process
    // throw) is a different path from a resolved result carrying `failed`.
    mockPruneLockEntries.mockRejectedValue(new Error('IPC channel closed'))
    mockScanStaleLockEntries.mockResolvedValue({
      status: 'ok',
      names: [toSkillName('old-skill')],
      unprunable: [],
    })
    const { screen, store } = await renderDialog(['old-skill'])

    // Act
    await screen.getByRole('button', { name: 'Remove 1 record' }).click()

    // Assert — the user gets a closed dialog, not silence behind a dead button.
    await vi.waitFor(() => {
      expect(store.getState().ui.lockPruneDialogOpen).toBe(false)
    })
    expect(store.getState().skillLock.staleNames).toEqual(['old-skill'])
  })

  test('removes the records it listed, not ones a scan added while it was open', async () => {
    // Arrange — the confirm button is the consent gate for a delegated
    // recursive delete. A scan landing mid-dialog must not widen what it acts
    // on: the user never read the extra name.
    mockPruneLockEntries.mockResolvedValue({
      pruned: ['old-skill'],
      skipped: [],
      failed: [],
    })
    const { screen, store } = await renderDialog(['old-skill'])
    const { fetchStaleLockEntries } =
      await import('@/renderer/src/redux/slices/skillLockSlice')

    // Act
    store.dispatch(fetchStaleLockEntries.pending('req-late', undefined))
    store.dispatch(
      fetchStaleLockEntries.fulfilled(
        {
          status: 'ok',
          names: [toSkillName('old-skill'), toSkillName('just-appeared')],
          unprunable: [],
        },
        'req-late',
        undefined,
      ),
    )
    // The label itself is the assertion: a live read would say "Remove 2
    // records" here and this query would find nothing.
    await screen.getByRole('button', { name: 'Remove 1 record' }).click()

    // Assert
    expect(mockPruneLockEntries).toHaveBeenCalledWith({ names: ['old-skill'] })
  })

  test('closes without touching the lock when the user cancels', async () => {
    // Arrange
    const { screen, store } = await renderDialog(['old-skill'])

    // Act
    await screen.getByRole('button', { name: 'Cancel' }).click()

    // Assert
    expect(mockPruneLockEntries).not.toHaveBeenCalled()
    expect(store.getState().ui.lockPruneDialogOpen).toBe(false)
  })

  test('does not claim success when main pruned nothing and kept every record', async () => {
    // Arrange — main revalidates each name before deleting. If the skill came
    // back on disk or is still inside its undo window, nothing is removed and
    // nothing failed. "Removed 0 records" would claim work never done.
    mockPruneLockEntries.mockResolvedValue({
      pruned: [],
      skipped: ['came-back'],
      failed: [],
    })
    mockScanStaleLockEntries.mockResolvedValue({
      status: 'ok',
      names: [],
      unprunable: [],
    })
    const { screen } = await renderDialog(['came-back'])

    // Act
    await screen.getByRole('button', { name: 'Remove 1 record' }).click()

    // Assert
    await vi.waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalledWith(
        'Kept 1 record: nothing stale left to remove.',
      )
    })
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  test('reports a success toast naming how many records actually went', async () => {
    // Arrange
    mockPruneLockEntries.mockResolvedValue({
      pruned: ['old-skill'],
      skipped: [],
      failed: [],
    })
    mockScanStaleLockEntries.mockResolvedValue({
      status: 'ok',
      names: [],
      unprunable: [],
    })
    const { screen } = await renderDialog(['old-skill'])

    // Act
    await screen.getByRole('button', { name: 'Remove 1 record' }).click()

    // Assert
    await vi.waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Removed 1 record from the skill lock.',
      )
    })
    expect(mockToastInfo).not.toHaveBeenCalled()
  })
  test('explains why a blocked record cannot be removed instead of listing it as deletable', async () => {
    // Arrange
    // The scan refused this one because an agent holds a real folder under the
    // name. Offering it beside the removable records would send it to main, and
    // main would only refuse it again.
    const { screen } = await renderDialog(
      ['removable'],
      [{ name: 'agent-owned', reason: 'agent-copy' }],
    )

    // Assert
    await expect.element(screen.getByText('agent-owned')).toBeVisible()
    await expect
      .element(screen.getByText('1 record needs attention first'))
      .toBeVisible()
    await expect
      .element(
        screen.getByText(
          'An agent holds a real folder under this name, not a link — removing the record would delete that folder with it.',
        ),
      )
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Remove 1 record' }))
      .toBeVisible()
  })

  test('stops offering a record the scan blocked while the dialog was open', async () => {
    // Arrange
    const { screen, store } = await renderDialog([
      'plain-stale',
      'agent-copy-skill',
    ])
    const { fetchStaleLockEntries } =
      await import('@/renderer/src/redux/slices/skillLockSlice')

    // Act - an agent copy appears under one of the consented names mid-dialog.
    store.dispatch(fetchStaleLockEntries.pending('req-lock-2', undefined))
    store.dispatch(
      fetchStaleLockEntries.fulfilled(
        {
          status: 'ok',
          names: [toSkillName('plain-stale')],
          unprunable: [
            { name: toSkillName('agent-copy-skill'), reason: 'agent-copy' },
          ],
        },
        'req-lock-2',
        undefined,
      ),
    )

    // Assert - the button drops it rather than promising a delete the blocked
    // section on the same screen says is impossible.
    await expect
      .element(screen.getByRole('button', { name: 'Remove 1 record' }))
      .toBeVisible()
    await expect
      .element(screen.getByText('1 record needs attention first'))
      .toBeVisible()
  })

  test('offers no delete button at all when every stale record is blocked', async () => {
    // Arrange
    // This is the dead end the feature used to have: nothing prunable meant no
    // CTA, no dialog, and no explanation anywhere. A "Remove 0 records" button
    // would be just as wrong.
    const { screen } = await renderDialog(
      [],
      [
        { name: 'ambiguous', reason: 'name-collision' },
        { name: 'Ambiguous', reason: 'name-collision' },
      ],
    )

    // Assert
    await expect
      .element(screen.getByText('2 records need attention first'))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Got it' }))
      .toBeVisible()
    expect(
      screen.getByRole('button', { name: /^Remove/ }).elements(),
    ).toHaveLength(0)
  })

  test('hides the corner close button while a prune is running', async () => {
    // Arrange
    // `handleClose` already refuses to close mid-prune, so leaving the X on
    // screen rendered a control that silently did nothing when clicked.
    let releasePrune: (result: unknown) => void = () => {}
    mockPruneLockEntries.mockReturnValue(
      new Promise((resolve) => {
        releasePrune = resolve
      }),
    )
    const { screen } = await renderDialog(['old-skill'])
    await expect
      .element(screen.getByRole('button', { name: 'Close' }))
      .toBeVisible()

    // Act
    await screen.getByRole('button', { name: 'Remove 1 record' }).click()

    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Pruning...' }))
      .toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Close' }).elements(),
    ).toHaveLength(0)
    releasePrune({ pruned: ['old-skill'], skipped: [], failed: [] })
  })
})
