import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { SyncExecuteResult, SyncResultItem } from '@/shared/types'

/**
 * Build a SyncExecuteResult from just the per-item `details` the widget renders.
 * The summary counts (`created`/`replaced`/`skipped`/`errors`) are derived so
 * the fixture stays internally consistent even though the widget ignores them.
 * @param details - Per-item sync outcomes shown as timeline rows.
 */
function makeSyncResult(details: SyncResultItem[]): SyncExecuteResult {
  const errors = details.flatMap((item) =>
    item.action === 'error'
      ? [
          {
            path: `/Users/test/.agents/skills/${item.skillName}`,
            error: item.error,
          },
        ]
      : [],
  )
  return {
    success: errors.length === 0,
    created: details.filter((item) => item.action === 'created').length,
    replaced: details.filter((item) => item.action === 'replaced').length,
    skipped: details.filter((item) => item.action === 'skipped').length,
    errors,
    details,
  }
}

/**
 * Seed `ui.syncResult` with the given result (or leave it null) and render the
 * timeline inside a sized wrapper. Seeding via `executeSyncAction.fulfilled`
 * avoids mocking the sync IPC call.
 * @param syncResult - Result to seed, or null for the pristine "no activity" state.
 */
async function renderTimeline(syncResult: SyncExecuteResult | null) {
  const [
    { default: uiReducer, executeSyncAction },
    { ActivityTimelineWidget },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/uiSlice'),
    import('./ActivityTimelineWidget'),
  ])
  const store = configureStore({ reducer: { ui: uiReducer } })
  if (syncResult) {
    store.dispatch(
      executeSyncAction.fulfilled(syncResult, 'req-sync', {
        replaceConflicts: [],
      }),
    )
  }

  const screen = await render(
    <Provider store={store}>
      <div style={{ width: 320, height: 240 }}>
        <ActivityTimelineWidget />
      </div>
    </Provider>,
  )
  return { screen, store }
}

describe('ActivityTimelineWidget', () => {
  it('shows the no-activity hint before any sync has run', async () => {
    // Arrange + Act: no sync result seeded into the store.
    const { screen } = await renderTimeline(null)

    // Assert
    await expect.element(screen.getByText('No recent activity')).toBeVisible()
    await expect
      .element(screen.getByText('Run Sync to see per-item results here.'))
      .toBeVisible()
  })

  it('lists each synced skill alongside its agent and action label', async () => {
    // Arrange: three rows from one sync, distinct agents and actions.
    const syncResult = makeSyncResult([
      { skillName: 'alpha-skill', agentName: 'Claude Code', action: 'created' },
      { skillName: 'beta-skill', agentName: 'Cursor', action: 'skipped' },
      { skillName: 'gamma-skill', agentName: 'Codex', action: 'replaced' },
    ])

    // Act
    const { screen } = await renderTimeline(syncResult)

    // Assert: scope each assertion to its own row (`listitem`) so the test
    // verifies same-row correspondence. A regression that scrambled which
    // agent or action renders next to which skill would fail here, whereas a
    // global text search would still pass. Rows render in sync-result order.
    const rows = screen.getByRole('listitem')
    await expect.element(rows.nth(0)).toHaveTextContent('alpha-skill')
    await expect.element(rows.nth(0)).toHaveTextContent('Claude Code')
    await expect.element(rows.nth(0)).toHaveTextContent('created')
    await expect.element(rows.nth(1)).toHaveTextContent('beta-skill')
    await expect.element(rows.nth(1)).toHaveTextContent('Cursor')
    await expect.element(rows.nth(1)).toHaveTextContent('skipped')
    await expect.element(rows.nth(2)).toHaveTextContent('gamma-skill')
    await expect.element(rows.nth(2)).toHaveTextContent('Codex')
    await expect.element(rows.nth(2)).toHaveTextContent('replaced')
  })

  it('shows the failure reason on an errored sync row', async () => {
    // Arrange: a single errored row carrying a permission-denied message.
    const syncResult = makeSyncResult([
      {
        skillName: 'delta-skill',
        agentName: 'Claude Code',
        action: 'error',
        error: 'EACCES: permission denied',
      },
    ])

    // Act
    const { screen } = await renderTimeline(syncResult)

    // Assert: the row shows the skill, the error label, and the reason text.
    await expect.element(screen.getByText('delta-skill')).toBeVisible()
    await expect.element(screen.getByText('error')).toBeVisible()
    await expect
      .element(screen.getByText('EACCES: permission denied'))
      .toBeVisible()
  })

  it('reveals the appended detail text when a row carries a failure message', async () => {
    // Arrange: an errored row whose `error` message makes detailText truthy,
    // which is the only way the appended detail span renders.
    const syncResult = makeSyncResult([
      {
        skillName: 'epsilon-skill',
        agentName: 'Codex',
        action: 'error',
        error: 'ENOENT: source skill no longer exists',
      },
    ])

    // Act
    const { screen } = await renderTimeline(syncResult)

    // Assert: the detail span (only mounted on the truthy detailText path) is
    // visible with its failure reason.
    await expect
      .element(screen.getByText('ENOENT: source skill no longer exists'))
      .toBeVisible()
  })
})
