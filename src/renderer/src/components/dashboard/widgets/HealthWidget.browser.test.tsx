import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it, test } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { Skill, SymlinkInfo } from '@/shared/types'

/**
 * Builds a SymlinkInfo fixture for HealthWidget display-state tests.
 * @param status - Symlink status counted by the widget.
 * @returns Minimal symlink slot.
 * @example
 * makeSymlink('broken').status // => 'broken'
 */
function makeSymlink(status: SymlinkInfo['status']): SymlinkInfo {
  return {
    agentId: 'cursor',
    agentName: 'Cursor',
    status,
    linkPath: '/Users/test/.cursor/skills/task',
    targetPath: '/Users/test/.agents/skills/task',
    isLocal: false,
  }
}

/**
 * Builds a Skill fixture whose symlink slots drive the widget totals.
 * @param symlinks - Slots counted by the HealthWidget.
 * @returns Skill fixture for the Redux store.
 * @example
 * makeSkill([makeSymlink('valid')]).symlinkCount // => 1
 */
function makeSkill(symlinks: SymlinkInfo[]): Skill {
  return {
    name: 'task',
    description: 'Task skill',
    path: '/Users/test/.agents/skills/task',
    symlinkCount: symlinks.filter((symlink) => symlink.status === 'valid')
      .length,
    symlinks,
    isSource: true,
    isOrphan: false,
  }
}

/**
 * Renders HealthWidget with real skills/skillLock/ui reducers so button clicks update Redux normally.
 * @param skills - Skill inventory to seed through the fetchSkills.fulfilled reducer.
 * @param staleLockNames - Stale skill-lock records to seed; empty means a clean lock.
 * @param scanStatus - `unavailable` seeds a scan that could not read the lock.
 * @param unprunable - Stale records the scan refused to offer for deletion.
 * @returns Browser screen and store.
 * @example
 * const { screen } = await renderHealthWidget([makeSkill([makeSymlink('broken')])])
 */
async function renderHealthWidget(
  skills: Skill[],
  staleLockNames: string[] = [],
  scanStatus: 'ok' | 'unavailable' = 'ok',
  unprunable: { name: string; reason: 'name-collision' | 'agent-copy' }[] = [],
) {
  const [
    { default: skillsReducer, fetchSkills },
    { default: skillLockReducer, fetchStaleLockEntries },
    { default: uiReducer },
    { HealthWidget },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/skillLockSlice'),
    import('@/renderer/src/redux/slices/uiSlice'),
    import('./HealthWidget'),
  ])
  const store = configureStore({
    reducer: {
      skills: skillsReducer,
      skillLock: skillLockReducer,
      ui: uiReducer,
    },
  })
  store.dispatch(fetchSkills.fulfilled(skills, 'req-skills'))
  // `pending` first: the reducer only applies a scan result whose requestId is
  // the newest one it issued, so a bare `fulfilled` would be ignored.
  store.dispatch(fetchStaleLockEntries.pending('req-lock', undefined))
  store.dispatch(
    fetchStaleLockEntries.fulfilled(
      scanStatus === 'ok'
        ? { status: 'ok', names: staleLockNames, unprunable }
        : { status: 'unavailable' },
      'req-lock',
      undefined,
    ),
  )

  const screen = await render(
    <Provider store={store}>
      <div style={{ width: 240, height: 160 }}>
        <HealthWidget />
      </div>
    </Provider>,
  )
  return { screen, store }
}

describe('HealthWidget', () => {
  it('opens the Symlink Health cleanup dialog when broken links exist', async () => {
    // Arrange
    const skills = [makeSkill([makeSymlink('valid'), makeSymlink('broken')])]
    const { screen, store } = await renderHealthWidget(skills)

    // Act
    await screen.getByRole('button', { name: 'Scan issues' }).click()

    // Assert
    expect(store.getState().ui.symlinkCleanupDialogOpen).toBe(true)
  })

  it('shows Healthy instead of Scan issues when no broken links exist', async () => {
    // Arrange
    const skills = [makeSkill([makeSymlink('valid')])]

    // Act
    const { screen } = await renderHealthWidget(skills)

    // Assert
    await expect.element(screen.getByText('Healthy')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Scan issues' }).query(),
    ).toBeNull()
  })

  it('shows Manual review instead of Healthy when only inaccessible links need attention', async () => {
    // Arrange
    const skills = [makeSkill([makeSymlink('inaccessible')])]

    // Act
    const { screen } = await renderHealthWidget(skills)

    // Assert
    await expect.element(screen.getByText('Manual review')).toBeVisible()
    await expect
      .element(screen.getByText('manual', { exact: true }))
      .toBeVisible()
    await expect
      .element(
        screen.getByRole('img', {
          name: '0 valid, 0 cleanup issues, 1 manual review',
        }),
      )
      .toBeInTheDocument()
    expect(screen.getByText('Healthy').query()).toBeNull()
    expect(screen.getByText('broken').query()).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Scan issues' }).query(),
    ).toBeNull()
  })

  it('splits cleanup-ready and manual-review counts when both need attention', async () => {
    // Arrange
    const skills = [
      makeSkill([
        makeSymlink('valid'),
        makeSymlink('broken'),
        makeSymlink('inaccessible'),
      ]),
    ]

    // Act
    const { screen } = await renderHealthWidget(skills)

    // Assert
    await expect.element(screen.getByText('cleanup')).toBeVisible()
    // Exact: the footer's "Manual review" label now also renders in this state,
    // and a substring match would resolve to both.
    await expect
      .element(screen.getByText('manual', { exact: true }))
      .toBeVisible()
    await expect
      .element(
        screen.getByRole('img', {
          name: '1 valid, 1 cleanup issue, 1 manual review',
        }),
      )
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: 'Scan issues' }))
      .toBeVisible()
  })

  test('still flags manual review when a stale lock record coexists with it', async () => {
    // Arrange — the case that hid the label: an unreadable link plus a lock
    // record. Neither CTA in the footer resolves an inaccessible link, so
    // dropping the label left that link with nothing pointing at it.
    const skills = [makeSkill([makeSymlink('inaccessible')])]

    // Act
    const { screen } = await renderHealthWidget(skills, ['old-skill'])

    // Assert
    await expect.element(screen.getByText('Manual review')).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Prune lock' }))
      .toBeVisible()
  })

  test('still flags manual review when broken links coexist with it', async () => {
    // Arrange — same bug on the other flag: "Scan issues" opens the broken-link
    // cleanup, which never touches an inaccessible link.
    const skills = [
      makeSkill([makeSymlink('broken'), makeSymlink('inaccessible')]),
    ]

    // Act
    const { screen } = await renderHealthWidget(skills)

    // Assert
    await expect.element(screen.getByText('Manual review')).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Scan issues' }))
      .toBeVisible()
  })

  it('does not present a remaining cleanup issue as 100 percent healthy', async () => {
    // Arrange
    const symlinks = [
      ...Array.from({ length: 1035 }, () => makeSymlink('valid')),
      makeSymlink('broken'),
    ]
    const skills = [makeSkill(symlinks)]

    // Act
    const { screen } = await renderHealthWidget(skills)

    // Assert
    await expect.element(screen.getByText('99.9%')).toBeVisible()
    expect(screen.getByText('100%').query()).toBeNull()
    await expect
      .element(screen.getByRole('button', { name: 'Scan issues' }))
      .toBeVisible()
  })
})

describe('HealthWidget stale skill-lock records', () => {
  it('offers Prune lock when the skills CLI still tracks a deleted skill', async () => {
    // Arrange
    const skills = [makeSkill([makeSymlink('valid')])]
    const { screen, store } = await renderHealthWidget(skills, ['old-skill'])

    // Act
    await screen.getByRole('button', { name: 'Prune lock' }).click()

    // Assert
    expect(store.getState().ui.lockPruneDialogOpen).toBe(true)
  })

  it('shows both actions at once when links are broken AND lock records are stale', async () => {
    // Arrange — the two problems are independent, so one must not hide the other.
    const skills = [makeSkill([makeSymlink('valid'), makeSymlink('broken')])]

    // Act
    const { screen } = await renderHealthWidget(skills, ['old-skill'])

    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Scan issues' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Prune lock' }))
      .toBeVisible()
  })

  it('counts stale lock records separately from symlinks', async () => {
    // Arrange — a lock record has no agent and no link, so it cannot be folded
    // into the broken/inaccessible symlink tallies.
    const skills = [makeSkill([makeSymlink('valid')])]

    // Act
    const { screen } = await renderHealthWidget(skills, ['a', 'b'])

    // Assert
    await expect
      .element(screen.getByText('lock', { exact: true }))
      .toBeVisible()
    await expect
      .element(
        screen.getByRole('img', {
          name: '1 valid, 0 cleanup issues, 0 manual review',
        }),
      )
      .toBeInTheDocument()
  })

  it('does not report Healthy while lock records are still stale', async () => {
    // Arrange
    const skills = [makeSkill([makeSymlink('valid')])]

    // Act
    const { screen } = await renderHealthWidget(skills, ['old-skill'])

    // Assert
    expect(screen.getByText('Healthy').query()).toBeNull()
  })

  it('stays on Healthy when the lock scan came back unavailable', async () => {
    // Arrange — main could not compare the lock against disk. Offering a
    // cleanup action there would promise something main would refuse to do.
    const skills = [makeSkill([makeSymlink('valid')])]

    // Act
    const { screen } = await renderHealthWidget(skills, [], 'unavailable')

    // Assert
    await expect.element(screen.getByText('Healthy')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Prune lock' }).query(),
    ).toBeNull()
  })

  test('counts blocked lock records so an all-blocked lock never reports Healthy', async () => {
    // Arrange
    // These records disagree with disk exactly as much as prunable ones do.
    // Leaving them out of the count showed "Healthy" while `skills -g update`
    // kept resurrecting the skills behind them.
    const skills = [makeSkill([makeSymlink('valid')])]

    // Act
    const { screen } = await renderHealthWidget(skills, [], 'ok', [
      { name: 'ambiguous', reason: 'name-collision' },
      { name: 'Ambiguous', reason: 'name-collision' },
    ])

    // Assert
    await expect
      .element(screen.getByText('lock', { exact: true }))
      .toBeVisible()
    await expect.element(screen.getByText('2', { exact: true })).toBeVisible()
    expect(screen.getByText('Healthy').query()).toBeNull()
  })

  test('offers Review lock rather than Prune lock when nothing can be removed', async () => {
    // Arrange
    // The dialog behind this button has no delete to offer, so promising a
    // prune would misdescribe what clicking it does.
    const skills = [makeSkill([makeSymlink('valid')])]

    // Act
    const { screen, store } = await renderHealthWidget(skills, [], 'ok', [
      { name: 'agent-owned', reason: 'agent-copy' },
    ])
    await screen.getByRole('button', { name: 'Review lock' }).click()

    // Assert
    expect(store.getState().ui.lockPruneDialogOpen).toBe(true)
  })

  test('still says Prune lock while at least one record can be removed', async () => {
    // Arrange
    // The discriminating case for the label: a mixed lock keeps the
    // destructive verb, because the button really does open a delete.
    const skills = [makeSkill([makeSymlink('valid')])]

    // Act
    const { screen } = await renderHealthWidget(skills, ['removable'], 'ok', [
      { name: 'agent-owned', reason: 'agent-copy' },
    ])

    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Prune lock' }))
      .toBeVisible()
  })
})
