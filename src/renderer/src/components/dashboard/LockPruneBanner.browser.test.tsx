import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, test } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'

/**
 * Render the announcement with real reducers so dismissal and the CTA go
 * through the same Redux path the app uses.
 * @param staleLockNames - Stale records to seed; empty means nothing to announce.
 * @param dismissed - Whether the user already dismissed the announcement.
 * @returns Browser screen and store.
 * @example const { screen } = await renderBanner(['old-skill'])
 */
async function renderBanner(staleLockNames: string[], dismissed = false) {
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
  store.dispatch(
    fetchStaleLockEntries.fulfilled(
      { status: 'ok', names: staleLockNames },
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
