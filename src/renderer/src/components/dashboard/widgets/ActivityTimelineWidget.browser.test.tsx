import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { ActivityEvent } from '@/shared/activityLog'

/**
 * Seed the activity slice with the given events and render the timeline inside
 * a sized wrapper. Dispatching `setActivityEvents` is exactly what
 * `useActivitySync` does after `activity:list` resolves, so this exercises the
 * real renderer data path without mocking IPC.
 * @param events - Newest-first events to seed, or [] for the pristine state.
 */
async function renderTimeline(events: ActivityEvent[]) {
  const [
    { default: activityReducer, setActivityEvents },
    { ActivityTimelineWidget },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/activitySlice'),
    import('./ActivityTimelineWidget'),
  ])
  const store = configureStore({ reducer: { activity: activityReducer } })
  if (events.length > 0) {
    store.dispatch(setActivityEvents(events))
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
  it('shows the no-activity hint before any activity has been recorded', async () => {
    // Arrange + Act: no events seeded into the store.
    const { screen } = await renderTimeline([])

    // Assert
    await expect.element(screen.getByText('No recent activity')).toBeVisible()
    await expect
      .element(
        screen.getByText('Add, remove, or sync skills to see activity here.'),
      )
      .toBeVisible()
  })

  it('lists each event with its skill, agent, and action label in newest-first order', async () => {
    // Arrange: three events of distinct types, already newest-first.
    const events: ActivityEvent[] = [
      {
        id: 'e1',
        timestamp: '2026-06-18T10:00:00.000Z',
        type: 'created',
        skillName: 'alpha-skill',
        agentName: 'Claude Code',
      },
      {
        id: 'e2',
        timestamp: '2026-06-18T09:00:00.000Z',
        type: 'removed',
        skillName: 'beta-skill',
        agentName: 'Cursor',
      },
      {
        id: 'e3',
        timestamp: '2026-06-18T08:00:00.000Z',
        type: 'synced',
        skillName: 'Sync',
        detail: '4 created · 0 replaced · 1 skipped',
      },
    ]

    // Act
    const { screen } = await renderTimeline(events)

    // Assert: scope each assertion to its own row (`listitem`) so the test
    // verifies same-row correspondence. A regression that scrambled which agent
    // or label renders next to which skill would fail here, whereas a global
    // text search would still pass. Rows render in the seeded (newest-first) order.
    const rows = screen.getByRole('listitem')
    await expect.element(rows.nth(0)).toHaveTextContent('alpha-skill')
    await expect.element(rows.nth(0)).toHaveTextContent('Claude Code')
    await expect.element(rows.nth(0)).toHaveTextContent('created')
    await expect.element(rows.nth(1)).toHaveTextContent('beta-skill')
    await expect.element(rows.nth(1)).toHaveTextContent('Cursor')
    await expect.element(rows.nth(1)).toHaveTextContent('removed')
    await expect.element(rows.nth(2)).toHaveTextContent('Sync')
    await expect.element(rows.nth(2)).toHaveTextContent('synced')
  })

  it('shows the detail text on a sync summary event that carries one', async () => {
    // Arrange: a single sync summary event with a counts detail string.
    const events: ActivityEvent[] = [
      {
        id: 's1',
        timestamp: '2026-06-18T10:00:00.000Z',
        type: 'synced',
        skillName: 'Sync',
        detail: '10 created · 1 replaced · 5 skipped',
      },
    ]

    // Act
    const { screen } = await renderTimeline(events)

    // Assert: scope to the single row to avoid the 'Sync'/'synced' substring
    // overlap (Playwright getByText is case-insensitive substring). The row
    // carries the skill label, the action label, and the detail counts.
    const row = screen.getByRole('listitem')
    await expect.element(row).toHaveTextContent('Sync')
    await expect.element(row).toHaveTextContent('synced')
    await expect
      .element(row)
      .toHaveTextContent('10 created · 1 replaced · 5 skipped')
  })

  it('omits the appended detail separator for an event with no detail', async () => {
    // Arrange: a `created` event with no detail — the appended " — detail" span
    // must not render. Covers the falsy branch of `{event.detail && <span>…}`,
    // the complement of the sync-summary test above.
    const events: ActivityEvent[] = [
      {
        id: 'c1',
        timestamp: '2026-06-18T10:00:00.000Z',
        type: 'created',
        skillName: 'epsilon-skill',
        agentName: 'Codex',
      },
    ]

    // Act
    const { screen } = await renderTimeline(events)

    // Assert: the skill row and its action label show, but the em-dash detail
    // separator (rendered only on the truthy `event.detail` path) is absent.
    await expect.element(screen.getByText('epsilon-skill')).toBeVisible()
    await expect.element(screen.getByText('created')).toBeVisible()
    expect(screen.getByText(/—/).query()).toBeNull()
  })
})
