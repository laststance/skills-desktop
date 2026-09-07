import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, test } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { UnprunableLockEntry } from '@/shared/types'
import { toSkillName } from '@/shared/types'

/**
 * Render the announcement with real reducers so dismissal and the CTA go
 * through the same Redux path the app uses.
 * @param staleLockNames - Stale records to seed; empty means nothing to announce.
 * @param dismissed - Whether the user already dismissed the announcement.
 * @param unprunable - Blocked records to seed alongside the prunable ones.
 * @returns Browser screen and store.
 * @example const { screen } = await renderBanner(['old-skill'])
 */
async function renderBanner(
  staleLockNames: string[],
  dismissed = false,
  unprunable: UnprunableLockEntry[] = [],
) {
  const [
    { default: dashboardReducer, dismissLockPruneBanner },
    { default: skillLockReducer, fetchStaleLockEntries },
    { default: uiReducer },
    { LockPruneBanner },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/dashboardSlice'),
    import('@/renderer/src/redux/slices/skillLockSlice'),
    import('@/renderer/src/redux/slices/uiSlice'),
    import('./LockPruneBanner'),
  ])
  const store = configureStore({
    reducer: {
      dashboard: dashboardReducer,
      skillLock: skillLockReducer,
      ui: uiReducer,
    },
  })
  // `pending` first: the reducer only applies a scan result whose requestId is
  // the newest one it issued, so a bare `fulfilled` would be ignored.
  store.dispatch(fetchStaleLockEntries.pending('req-lock', undefined))
  store.dispatch(
    fetchStaleLockEntries.fulfilled(
      { status: 'ok', names: staleLockNames.map(toSkillName), unprunable },
      'req-lock',
      undefined,
    ),
  )
  if (dismissed) store.dispatch(dismissLockPruneBanner())

  const screen = await render(
    <Provider store={store}>
      <LockPruneBanner />
    </Provider>,
  )
  return { screen, store }
}

describe('LockPruneBanner', () => {
  test('announces the capability the first time stale lock records are found', async () => {
    // Arrange / Act
    const { screen } = await renderBanner(['old-skill'])

    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Prune lock' }))
      .toBeVisible()
  })

  test('stays hidden when the lock and the installed skills already agree', async () => {
    // Arrange / Act
    const { screen } = await renderBanner([])

    // Assert
    expect(
      screen.getByRole('button', { name: 'Prune lock' }).query(),
    ).toBeNull()
  })

  test('stays hidden when every stale record is blocked from being pruned', async () => {
    // Arrange / Act
    const { screen } = await renderBanner([], false, [
      { name: toSkillName('agent-copy-skill'), reason: 'agent-copy' },
    ])

    // Assert
    expect(
      screen.getByRole('button', { name: 'Prune lock' }).query(),
    ).toBeNull()
  })

  test('counts only the records it can actually prune, not every stale one', async () => {
    // Arrange / Act — one prunable record alongside one the scan blocked. The
    // all-blocked case above passes under any gate that hides the banner when
    // something is blocked; only a mix proves the sentence counts the prunable
    // subset rather than every record needing attention.
    const { screen } = await renderBanner(['plain-stale'], false, [
      { name: toSkillName('agent-copy-skill'), reason: 'agent-copy' },
    ])

    // Assert
    await expect
      .element(
        screen.getByText(/still tracks 1 record for a skill you deleted,/),
      )
      .toBeVisible()
  })

  test('opens the prune dialog from the announcement CTA', async () => {
    // Arrange
    const { screen, store } = await renderBanner(['old-skill'])

    // Act
    await screen.getByRole('button', { name: 'Prune lock' }).click()

    // Assert
    expect(store.getState().ui.lockPruneDialogOpen).toBe(true)
  })

  test('never comes back once dismissed, even while records are still stale', async () => {
    // Arrange — the HealthWidget row is the recurring surface; the banner
    // exists to introduce the feature once, not to nag.
    const { screen, store } = await renderBanner(['old-skill'])

    // Act
    await screen
      .getByRole('button', { name: 'Dismiss skill lock announcement' })
      .click()

    // Assert
    expect(store.getState().dashboard.lockPruneBannerDismissed).toBe(true)
    expect(
      screen.getByRole('button', { name: 'Prune lock' }).query(),
    ).toBeNull()
  })

  test('stays hidden on a later launch after a previous dismissal', async () => {
    // Arrange / Act
    const { screen } = await renderBanner(['old-skill'], true)

    // Assert
    expect(
      screen.getByRole('button', { name: 'Prune lock' }).query(),
    ).toBeNull()
  })
})
