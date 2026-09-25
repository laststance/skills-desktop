import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { type Locator, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

// Real Tailwind output: the header's layout tiers are container queries.
import '@/renderer/src/styles/globals.css'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import type { AgentId } from '@/shared/constants'
import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'
import type { Skill, SkillName, SymlinkInfo } from '@/shared/types'
import {
  toAbsolutePath,
  toBatchItemCount,
  toBatchItemIndex,
  toFileSizeBytes,
  toSearchQuery,
  toSkillName,
  toSymlinkCount,
} from '@/shared/types'

/** A header this wide keeps every label (content box above 30rem). */
const WIDE_HEADER_WIDTH_PX = 640
/** A header this wide is in the narrow tier (content box between 24rem and 30rem). */
const NARROW_HEADER_WIDTH_PX = 440
/**
 * The header's width at the supported floor: a 264px center column (the 800px
 * minimum window) minus the list column's 16px left and 5px right padding, and
 * the 6px scrollbar gutter plus 5px row inset it reserves to end with the cards.
 */
const FLOOR_HEADER_WIDTH_PX = 232
/** Radix opens a tooltip 700ms after hover by default; wait past that. */
const TOOLTIP_OPEN_TIMEOUT_MS = 3_000

/**
 * Build a source skill fixture with one Cursor symlink slot for header tests.
 * @param name - Skill name shown in Redux and bulk payloads.
 * @param status - Cursor symlink status; drives bulk eligibility per row.
 * @returns Skill fixture the real skills reducer can load via fetchSkills.fulfilled.
 * @example makeCursorSkill('alpha', 'valid').symlinks[0]?.status // => 'valid'
 */
function makeCursorSkill(
  name: SkillName,
  status: SymlinkInfo['status'],
): Skill {
  return {
    name,
    description: '',
    path: toAbsolutePath(`/Users/test/.agents/skills/${name}`),
    symlinkCount: toSymlinkCount(status === 'missing' ? 0 : 1),
    symlinks: [
      {
        agentId: 'cursor',
        agentName: 'Cursor',
        status,
        linkPath: toAbsolutePath(`/Users/test/.cursor/skills/${name}`),
        targetPath: toAbsolutePath(`/Users/test/.agents/skills/${name}`),
        isLocal: false,
      },
    ],
    isSource: true,
    isOrphan: false,
  }
}

/**
 * Render InstalledListHeader against the real skills, ui, protect and settings
 * reducers, at a fixed width so its container-query tier is deterministic.
 * @param options.skills - Skill rows loaded into the Installed list.
 * @param options.selectedNames - Names ticked before mount.
 * @param options.agentId - Active agent filter; null = global delete view.
 * @param options.protectedNames - Skills locked against bulk actions.
 * @param options.countDisplay - Where the visible-skill count lives; `tab` by default.
 * @param options.headerWidthPx - The header's own width, which picks its layout tier.
 * @param options.onCopyAction - Optional copy callback; omit to hide Copy to…
 * @param options.agentDisplayName - Display name for the agent-view Unlink label.
 * @returns Browser screen, Redux store, and the primary-action spy.
 * @example
 * const { screen, store } = await renderHeader({ skills, selectedNames: [], agentId: null })
 */
async function renderHeader(options: {
  skills: Skill[]
  selectedNames: SkillName[]
  agentId: AgentId | null
  protectedNames?: SkillName[]
  countDisplay?: Settings['installedSearchCountDisplay']
  headerWidthPx?: number
  onCopyAction?: () => void
  agentDisplayName?: string
}) {
  const {
    skills,
    selectedNames,
    agentId,
    protectedNames = [],
    countDisplay = 'tab',
    headerWidthPx = WIDE_HEADER_WIDTH_PX,
    onCopyAction,
    agentDisplayName,
  } = options
  const [
    { default: skillsReducer, fetchSkills, selectAll },
    { default: uiReducer, selectAgent },
    { default: protectReducer, addProtection },
    { default: settingsReducer, setSettings },
    { InstalledListHeader },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/uiSlice'),
    import('@/renderer/src/redux/slices/protectSlice'),
    import('@/renderer/src/redux/slices/settingsSlice'),
    import('./InstalledListHeader'),
  ])

  const store = configureStore({
    reducer: {
      skills: skillsReducer,
      ui: uiReducer,
      protect: protectReducer,
      settings: settingsReducer,
    },
  })

  store.dispatch(fetchSkills.fulfilled(skills, 'skills-req'))
  store.dispatch(
    setSettings({
      ...DEFAULT_SETTINGS,
      installedSearchCountDisplay: countDisplay,
    }),
  )
  if (agentId !== null) store.dispatch(selectAgent(agentId))
  for (const name of protectedNames) store.dispatch(addProtection({ name }))
  if (selectedNames.length > 0) store.dispatch(selectAll(selectedNames))

  const onPrimaryAction = vi.fn()
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <div style={{ width: headerWidthPx }}>
          <InstalledListHeader
            onPrimaryAction={onPrimaryAction}
            onCopyAction={onCopyAction}
            agentDisplayName={agentDisplayName}
          />
        </div>
      </TooltipProvider>
    </Provider>,
  )

  return { screen, store, onPrimaryAction }
}

/**
 * Asserts a header control sits fully inside the header row, horizontally and
 * vertically, so a narrow header never clips or wraps it.
 * @param control - The button to measure.
 * @param header - The `List header` group.
 * @example expectInsideHeader(screen.getByRole('button', { name: 'Clear selection' }), header)
 */
function expectInsideHeader(control: Locator, header: Locator): void {
  const headerRect = header.element().getBoundingClientRect()
  const controlRect = control.element().getBoundingClientRect()
  expect(controlRect.left).toBeGreaterThanOrEqual(headerRect.left)
  expect(controlRect.right).toBeLessThanOrEqual(headerRect.right)
  expect(controlRect.top).toBeGreaterThanOrEqual(headerRect.top)
  expect(controlRect.bottom).toBeLessThanOrEqual(headerRect.bottom)
}

describe('InstalledListHeader rest state', () => {
  test('shows an unchecked master checkbox and the Name sort when nothing is selected', async () => {
    // Arrange — no mode to enter: the header is there from the first render
    const skills = [makeCursorSkill(toSkillName('alpha'), 'valid')]

    // Act
    const { screen } = await renderHeader({
      skills,
      selectedNames: [],
      agentId: null,
    })

    // Assert — rest state: master checkbox + sort, no count or bulk action
    await expect
      .element(screen.getByRole('group', { name: 'List header' }))
      .toBeVisible()
    const masterCheckbox = screen.getByRole('checkbox', {
      name: 'Select all 1 visible skill',
    })
    await expect.element(masterCheckbox).toBeVisible()
    await expect.element(masterCheckbox).not.toBeChecked()
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted A to Z, click to reverse',
        }),
      )
      .toBeVisible()
    expect(screen.getByText(/selected/).query()).toBeNull()
    expect(
      screen.getByRole('button', { name: /Move .* to app trash/i }).query(),
    ).toBeNull()
  })

  test('shows the visible skill count in the header when the count setting is List header', async () => {
    // Arrange
    const skills = [
      makeCursorSkill(toSkillName('alpha'), 'valid'),
      makeCursorSkill(toSkillName('beta'), 'valid'),
    ]

    // Act
    const { screen } = await renderHeader({
      skills,
      selectedNames: [],
      agentId: null,
      countDisplay: 'inline',
    })

    // Assert
    await expect.element(screen.getByText('2 skills')).toBeVisible()
  })

  test('updates the header count as the search narrows the list', async () => {
    // Arrange
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha-one'), 'valid'),
        makeCursorSkill(toSkillName('alpha-two'), 'valid'),
        makeCursorSkill(toSkillName('zeta'), 'valid'),
      ],
      selectedNames: [],
      agentId: null,
      countDisplay: 'inline',
    })
    await expect.element(screen.getByText('3 skills')).toBeVisible()
    const { setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(setSearchQuery(toSearchQuery('alpha')))

    // Assert
    await expect.element(screen.getByText('2 skills')).toBeVisible()
  })

  test('leaves the count out of the header when it lives on the Installed tab badge', async () => {
    // Arrange
    const skills = [
      makeCursorSkill(toSkillName('alpha'), 'valid'),
      makeCursorSkill(toSkillName('beta'), 'valid'),
    ]

    // Act
    const { screen } = await renderHeader({
      skills,
      selectedNames: [],
      agentId: null,
      countDisplay: 'tab',
    })

    // Assert — the sort stays; the count is the tab badge's job
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted A to Z, click to reverse',
        }),
      )
      .toBeVisible()
    expect(screen.getByText('2 skills').query()).toBeNull()
  })

  test('reverses the list order from the Name sort button', async () => {
    // Arrange
    const { screen, store } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [],
      agentId: null,
    })

    // Act
    await screen
      .getByRole('button', { name: 'Name, sorted A to Z, click to reverse' })
      .click()

    // Assert
    expect(store.getState().ui.sortOrder).toBe('desc')
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted Z to A, click to reverse',
        }),
      )
      .toBeVisible()
  })

  test('disables the sort button while a card Delete runs with nothing selected', async () => {
    // Arrange — a card's own Delete goes through the bulk delete thunk
    const { screen, store } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [],
      agentId: null,
    })
    const { deleteSelectedSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(
      deleteSelectedSkills.pending('delete-req', [
        {
          skillName: toSkillName('alpha'),
          skillPath: toAbsolutePath('/Users/test/.agents/skills/alpha'),
          filesystemIdentity: {
            kind: 'directory',
            dev: 1,
            ino: 2,
            size: toFileSizeBytes(96),
            ctimeMs: 3,
            mtimeMs: 4,
          },
        },
      ]),
    )

    // Assert
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted A to Z, click to reverse',
        }),
      )
      .toBeDisabled()
  })
})

describe('InstalledListHeader master checkbox', () => {
  test('selects every visible row from the master checkbox when nothing is ticked', async () => {
    // Arrange
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('beta'), 'valid'),
      ],
      selectedNames: [],
      agentId: null,
    })

    // Act
    await screen
      .getByRole('checkbox', { name: 'Select all 2 visible skills' })
      .click()

    // Assert — every row ticked, and the checkbox now offers the way back
    expect(store.getState().skills.selectedSkillNames).toEqual([
      'alpha',
      'beta',
    ])
    await expect
      .element(screen.getByRole('checkbox', { name: 'Deselect all' }))
      .toBeChecked()
    await expect.element(screen.getByText('2 selected')).toBeVisible()
  })

  test('shows the mixed state on the master checkbox when only some visible rows are ticked', async () => {
    // Arrange
    const skills = [
      makeCursorSkill(toSkillName('alpha'), 'valid'),
      makeCursorSkill(toSkillName('beta'), 'valid'),
    ]

    // Act
    const { screen } = await renderHeader({
      skills,
      selectedNames: [toSkillName('alpha')],
      agentId: null,
    })

    // Assert — W3C APG mixed checkbox
    await expect
      .element(
        screen.getByRole('checkbox', { name: 'Select all 2 visible skills' }),
      )
      .toHaveAttribute('aria-checked', 'mixed')
  })

  test('selects the rest of the visible rows from the mixed master checkbox', async () => {
    // Arrange — two rows, only one ticked
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('beta'), 'valid'),
      ],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
    })

    // Act
    await screen
      .getByRole('checkbox', { name: 'Select all 2 visible skills' })
      .click()

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual([
      'alpha',
      'beta',
    ])
  })

  test('clears the whole selection, filtered-out rows included, from the checked master checkbox', async () => {
    // Arrange — both visible rows ticked, plus one the search now hides
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha-one'), 'valid'),
        makeCursorSkill(toSkillName('alpha-two'), 'valid'),
        makeCursorSkill(toSkillName('zeta'), 'valid'),
      ],
      selectedNames: [
        toSkillName('alpha-one'),
        toSkillName('alpha-two'),
        toSkillName('zeta'),
      ],
      agentId: null,
    })
    const { setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(setSearchQuery(toSearchQuery('alpha')))

    // Act
    await screen.getByRole('checkbox', { name: 'Deselect all' }).click()

    // Assert — like Esc and Clear, unchecking drops the hidden tick too
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    await expect
      .element(
        screen.getByRole('checkbox', { name: 'Select all 2 visible skills' }),
      )
      .not.toBeChecked()
  })

  test('selects only the linked, unprotected rows from the master checkbox in agent view', async () => {
    // Arrange — Cursor view: one linked row, one broken link, one locked row
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('broken-skill'), 'broken'),
        makeCursorSkill(toSkillName('linked-skill'), 'valid'),
        makeCursorSkill(toSkillName('locked-skill'), 'valid'),
      ],
      selectedNames: [],
      agentId: 'cursor',
      protectedNames: [toSkillName('locked-skill')],
    })

    // Act
    await screen
      .getByRole('checkbox', { name: 'Select all 1 visible skill' })
      .click()

    // Assert
    expect(store.getState().skills.selectedSkillNames).toEqual(['linked-skill'])
  })

  test('disables the master checkbox when the list has no skills', async () => {
    // Arrange
    const skills: Skill[] = []

    // Act
    const { screen } = await renderHeader({
      skills,
      selectedNames: [],
      agentId: null,
      countDisplay: 'inline',
    })

    // Assert
    await expect
      .element(screen.getByRole('checkbox', { name: 'No skills to select' }))
      .toBeDisabled()
    await expect.element(screen.getByText('0 skills')).toBeVisible()
  })

  test('disables the master checkbox during the first skills scan, before any row is drawn', async () => {
    // Arrange — nothing has loaded yet
    const { screen, store } = await renderHeader({
      skills: [],
      selectedNames: [],
      agentId: null,
    })
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(fetchSkills.pending('first-scan'))

    // Assert
    await expect
      .element(screen.getByRole('checkbox', { name: 'No skills to select' }))
      .toBeDisabled()
  })

  test('keeps the master checkbox enabled while a refresh runs with rows on screen', async () => {
    // Arrange — two rows stay drawn while the list refreshes behind them
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('beta'), 'valid'),
      ],
      selectedNames: [],
      agentId: null,
    })
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(fetchSkills.pending('refresh'))

    // Assert — only an empty list or its error screen disables it
    await expect
      .element(
        screen.getByRole('checkbox', { name: 'Select all 2 visible skills' }),
      )
      .toBeEnabled()
  })

  test('disables the master checkbox while the list shows its load error', async () => {
    // Arrange — two rows on screen before a refresh fails
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('beta'), 'valid'),
      ],
      selectedNames: [],
      agentId: null,
    })
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(fetchSkills.pending('refresh'))
    store.dispatch(
      fetchSkills.rejected(new Error('disk read failed'), 'refresh'),
    )

    // Assert — the list draws only its error text, so nothing is selectable
    await expect
      .element(screen.getByRole('checkbox', { name: 'No skills to select' }))
      .toBeDisabled()
  })

  test('teaches the Cmd+A shortcut in the master checkbox tooltip', async () => {
    // Arrange
    const { screen } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('beta'), 'valid'),
      ],
      selectedNames: [],
      agentId: null,
    })

    // Act
    await screen
      .getByRole('checkbox', { name: 'Select all 2 visible skills' })
      .hover()

    // Assert
    await expect
      .element(screen.getByRole('tooltip'), {
        timeout: TOOLTIP_OPEN_TIMEOUT_MS,
      })
      .toHaveTextContent('Select all 2 visible skills⌘A')
  })

  test('teaches Esc in the master checkbox tooltip once every visible row is selected', async () => {
    // Arrange — every visible row ticked, so a click would clear, not select
    const { screen } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('beta'), 'valid'),
      ],
      selectedNames: [toSkillName('alpha'), toSkillName('beta')],
      agentId: null,
    })

    // Act
    await screen.getByRole('checkbox', { name: 'Deselect all' }).hover()

    // Assert — the hint names the key that does what the click does (the
    // whole-text match also rules out a stale ⌘A)
    await expect
      .element(screen.getByRole('tooltip'), {
        timeout: TOOLTIP_OPEN_TIMEOUT_MS,
      })
      .toHaveTextContent('Deselect allEsc')
  })

  test('leaves the shortcut hint off the master checkbox tooltip while nothing can be selected', async () => {
    // Arrange — an empty list disables the checkbox, and ⌘A does nothing
    const { screen } = await renderHeader({
      skills: [],
      selectedNames: [],
      agentId: null,
    })

    // Act
    await screen.getByRole('checkbox', { name: 'No skills to select' }).hover()

    // Assert — the whole tooltip text is the label, with no key after it
    await expect
      .element(screen.getByRole('tooltip'), {
        timeout: TOOLTIP_OPEN_TIMEOUT_MS,
      })
      .toHaveTextContent('No skills to select')
  })

  test('drops ticks the search hides when the master checkbox selects the visible rows', async () => {
    // Arrange — 'zeta' is ticked, then the search hides it
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha-one'), 'valid'),
        makeCursorSkill(toSkillName('alpha-two'), 'valid'),
        makeCursorSkill(toSkillName('zeta'), 'valid'),
      ],
      selectedNames: [toSkillName('zeta')],
      agentId: null,
    })
    const { setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(setSearchQuery(toSearchQuery('alpha')))
    await expect.element(screen.getByText('+1 hidden by filter')).toBeVisible()

    // Act
    await screen
      .getByRole('checkbox', { name: 'Select all 2 visible skills' })
      .click()

    // Assert — the selection becomes exactly the rows on screen
    expect(store.getState().skills.selectedSkillNames).toEqual([
      'alpha-one',
      'alpha-two',
    ])
    await expect.element(screen.getByText('2 selected')).toBeVisible()
    expect(screen.getByText(/hidden by filter/).query()).toBeNull()
  })
})

describe('InstalledListHeader selected state', () => {
  test('shows how many skills are selected in place of the sort button', async () => {
    // Arrange
    const skills = [
      makeCursorSkill(toSkillName('alpha'), 'valid'),
      makeCursorSkill(toSkillName('beta'), 'valid'),
      makeCursorSkill(toSkillName('gamma'), 'valid'),
    ]

    // Act
    const { screen } = await renderHeader({
      skills,
      selectedNames: [toSkillName('alpha'), toSkillName('beta')],
      agentId: null,
    })

    // Assert
    await expect.element(screen.getByText('2 selected')).toBeVisible()
    expect(
      screen.getByRole('button', { name: /^Name, sorted/ }).query(),
    ).toBeNull()
  })

  test('hides the inline skill count while skills are selected', async () => {
    // Arrange
    const skills = [
      makeCursorSkill(toSkillName('alpha'), 'valid'),
      makeCursorSkill(toSkillName('beta'), 'valid'),
    ]

    // Act
    const { screen } = await renderHeader({
      skills,
      selectedNames: [toSkillName('alpha')],
      agentId: null,
      countDisplay: 'inline',
    })

    // Assert — the selection summary takes the count's place
    await expect.element(screen.getByText('1 selected')).toBeVisible()
    expect(screen.getByText('2 skills').query()).toBeNull()
  })

  test('Clear selection empties the selection and returns the header to its rest state', async () => {
    // Arrange — global view with one ticked skill
    const { screen, store } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
    })
    await expect.element(screen.getByText('1 selected')).toBeVisible()

    // Act
    await screen.getByRole('button', { name: 'Clear selection' }).click()

    // Assert — the sort is back and the destructive action is gone
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted A to Z, click to reverse',
        }),
      )
      .toBeVisible()
    expect(
      screen.getByRole('button', { name: /Move .* to app trash/i }).query(),
    ).toBeNull()
  })

  test('teaches the Esc shortcut in the Clear selection tooltip', async () => {
    // Arrange
    const { screen } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
    })

    // Act
    await screen.getByRole('button', { name: 'Clear selection' }).hover()

    // Assert
    await expect
      .element(screen.getByRole('tooltip'), {
        timeout: TOOLTIP_OPEN_TIMEOUT_MS,
      })
      .toHaveTextContent('Clear selectionEsc')
  })

  test('warns when selected rows are hidden by the filter or visible-but-ineligible', async () => {
    // Arrange — agent view: one valid (eligible) + one broken (visible,
    // ineligible) on screen, plus one hidden by the search filter.
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha-valid'), 'valid'),
        makeCursorSkill(toSkillName('alpha-broken'), 'broken'),
        makeCursorSkill(toSkillName('zeta-hidden'), 'valid'),
      ],
      selectedNames: [
        toSkillName('alpha-valid'),
        toSkillName('alpha-broken'),
        toSkillName('zeta-hidden'),
      ],
      agentId: 'cursor',
    })
    const { setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Act — narrow the visible list so 'zeta-hidden' drops out of the filter
    store.dispatch(setSearchQuery(toSearchQuery('alpha')))

    // Assert — both indicators surface their counts in the wide header
    await expect.element(screen.getByText('+1 hidden by filter')).toBeVisible()
    await expect.element(screen.getByText('+1 not eligible')).toBeVisible()
  })

  test('disables the header Delete when every ticked row is hidden by the search', async () => {
    // Arrange — global view; the only tick is on a row the search will hide
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('zeta'), 'valid'),
      ],
      selectedNames: [toSkillName('zeta')],
      agentId: null,
    })
    const { setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(setSearchQuery(toSearchQuery('alpha')))

    // Assert — nothing on screen can be deleted, so the primary stays inert
    await expect
      .element(
        screen.getByRole('button', {
          name: 'No visible selected skills to delete',
        }),
      )
      .toBeDisabled()
    await expect.element(screen.getByText('No visible skills')).toBeVisible()
    await expect.element(screen.getByText('+1 hidden by filter')).toBeVisible()
  })

  test('replaces the indicators with the bulk progress counter for large batches', async () => {
    // Arrange — one visible tick and one hidden by the search
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('zeta'), 'valid'),
      ],
      selectedNames: [toSkillName('alpha'), toSkillName('zeta')],
      agentId: null,
    })
    const { setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const { setBulkProgress } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    store.dispatch(setSearchQuery(toSearchQuery('alpha')))
    await expect.element(screen.getByText('+1 hidden by filter')).toBeVisible()

    // Act — emit progress for a batch at the >= 10 threshold
    store.dispatch(
      setBulkProgress({
        current: toBatchItemIndex(3),
        total: toBatchItemCount(12),
      }),
    )

    // Assert
    await expect.element(screen.getByText('3 of 12')).toBeVisible()
    expect(screen.getByText('+1 hidden by filter').query()).toBeNull()
  })

  test('offers a Copy to… button in global view when a copy handler is wired', async () => {
    // Arrange — global view with a copy callback supplied
    const onCopyAction = vi.fn()
    const { screen } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
      onCopyAction,
    })
    const copyButton = screen.getByRole('button', {
      name: 'Copy selected skills to agents',
    })

    // Act
    await copyButton.click()

    // Assert
    expect(onCopyAction).toHaveBeenCalledTimes(1)
  })

  test('hides Copy to… in agent view even when a copy handler is wired', async () => {
    // Arrange
    const onCopyAction = vi.fn()

    // Act
    const { screen } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: 'cursor',
      onCopyAction,
      agentDisplayName: 'Cursor',
    })

    // Assert
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Unlink selected skill from Cursor',
        }),
      )
      .toBeVisible()
    expect(
      screen
        .getByRole('button', { name: 'Copy selected skills to agents' })
        .query(),
    ).toBeNull()
  })

  test('shows a destructive Delete action in global view', async () => {
    // Arrange
    const { screen, onPrimaryAction } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
    })
    const deleteButton = screen.getByRole('button', {
      name: 'Move selected skill to app trash',
    })

    // Act
    await deleteButton.click()

    // Assert — the wide header shows the full label, never the compact one
    expect(onPrimaryAction).toHaveBeenCalledTimes(1)
    await expect.element(screen.getByText('Delete skill')).toBeVisible()
    await expect
      .element(screen.getByText('Delete 1', { exact: true }))
      .not.toBeVisible()
  })

  test('shows a non-destructive Unlink action in agent view', async () => {
    // Arrange
    const { screen, onPrimaryAction } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: 'cursor',
      agentDisplayName: 'Cursor',
    })
    const unlinkButton = screen.getByRole('button', {
      name: 'Unlink selected skill from Cursor',
    })

    // Act
    await unlinkButton.click()

    // Assert
    expect(onPrimaryAction).toHaveBeenCalledTimes(1)
    await expect.element(screen.getByText('Unlink from Cursor')).toBeVisible()
  })

  test('disables every header control and shows a spinner while a bulk copy is in flight', async () => {
    // Arrange — global view, one of two rows ticked
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('beta'), 'valid'),
      ],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
      onCopyAction: vi.fn(),
    })
    const { bulkCopyToAgents } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(
      bulkCopyToAgents.pending('copy-req', { items: [], agentIds: [] }),
    )

    // Assert — the idle Trash2 icon is swapped for the in-flight spinner (a
    // regression that dropped the Loader2 branch would still pass the
    // disabled check but fail the spinner one).
    const deleteButton = screen.getByRole('button', {
      name: 'Move selected skill to app trash',
    })
    await expect.element(deleteButton).toBeDisabled()
    expect(deleteButton.element().querySelector('.animate-spin')).not.toBeNull()
    await expect
      .element(
        screen.getByRole('button', { name: 'Copy selected skills to agents' }),
      )
      .toBeDisabled()
    await expect
      .element(screen.getByRole('button', { name: 'Clear selection' }))
      .toBeDisabled()
    await expect
      .element(
        screen.getByRole('checkbox', { name: 'Select all 2 visible skills' }),
      )
      .toBeDisabled()
  })

  test('drops the Esc hint from Clear while a bulk op settles, since Esc cannot clear then', async () => {
    // Arrange — global view, one row ticked, Clear teaching Esc
    const { screen, store } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
      onCopyAction: vi.fn(),
    })
    const clearButton = screen.getByRole('button', { name: 'Clear selection' })
    await expect.element(clearButton).toHaveTextContent('ClearEsc')
    const { bulkCopyToAgents } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(
      bulkCopyToAgents.pending('copy-req', { items: [], agentIds: [] }),
    )

    // Assert — the disabled Clear no longer advertises a key that does nothing
    await expect.element(clearButton).toBeDisabled()
    await expect.element(clearButton).toHaveTextContent('Clear')
  })
})

describe('InstalledListHeader keyboard focus', () => {
  test('moves keyboard focus to the master checkbox when Clear empties the selection', async () => {
    // Arrange — a keyboard user on Clear, which the swap back to rest removes
    const { screen, store } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
    })
    screen.getByRole('button', { name: 'Clear selection' }).element().focus()

    // Act
    await userEvent.keyboard('{Enter}')

    // Assert — focus lands on the one control both states share
    expect(store.getState().skills.selectedSkillNames).toEqual([])
    await expect
      .element(
        screen.getByRole('checkbox', { name: 'Select all 1 visible skill' }),
      )
      .toHaveFocus()
  })

  test('moves keyboard focus to the master checkbox when a selection starts from the sort button', async () => {
    // Arrange — the sort button has focus when ⌘A selects every row
    const { screen, store } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [],
      agentId: null,
    })
    const { selectAll } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    screen
      .getByRole('button', { name: 'Name, sorted A to Z, click to reverse' })
      .element()
      .focus()

    // Act
    store.dispatch(selectAll([toSkillName('alpha')]))

    // Assert
    await expect
      .element(screen.getByRole('checkbox', { name: 'Deselect all' }))
      .toHaveFocus()
  })

  test('leaves focus on a control outside the header when the selection clears', async () => {
    // Arrange — focus sits outside the header, like on a list row
    const { screen, store } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
    })
    const { clearSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { toggleSortOrder } =
      await import('@/renderer/src/redux/slices/uiSlice')
    const controlOutsideHeader = document.createElement('button')
    controlOutsideHeader.textContent = 'Row outside the header'
    document.body.appendChild(controlOutsideHeader)
    onTestFinished(() => controlOutsideHeader.remove())
    controlOutsideHeader.focus()

    // Act — Esc on a row clears the selection through the store
    store.dispatch(clearSelection())
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted A to Z, click to reverse',
        }),
      )
      .toBeVisible()
    // React runs a render's effects before it starts the next one, so once
    // this second render lands the focus rescue has had its chance to act.
    store.dispatch(toggleSortOrder())
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Name, sorted Z to A, click to reverse',
        }),
      )
      .toBeVisible()

    // Assert
    expect(document.activeElement).toBe(controlOutsideHeader)
  })
})

describe('InstalledListHeader layout tiers', () => {
  test('keeps only the indicator numbers and an icon-only Copy button in the narrow header', async () => {
    // Arrange — one visible tick and one hidden by the search
    const { screen, store } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('zeta'), 'valid'),
      ],
      selectedNames: [toSkillName('alpha'), toSkillName('zeta')],
      agentId: null,
      onCopyAction: vi.fn(),
      headerWidthPx: NARROW_HEADER_WIDTH_PX,
    })
    const { setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(setSearchQuery(toSearchQuery('alpha')))

    // Assert — the number stays; the words shrink to the 1px sr-only box, so
    // screen readers still hear them, and the title keeps the whole sentence
    await expect
      .element(
        screen.getByTitle(
          '1 selected row is hidden by the current filter and will not be affected',
        ),
      )
      .toBeVisible()
    expect(
      screen.getByText('hidden by filter').element().getBoundingClientRect()
        .width,
    ).toBe(1)
    const copyButton = screen.getByRole('button', {
      name: 'Copy selected skills to agents',
    })
    await expect.element(copyButton).toBeVisible()
    expect(copyButton.element().getBoundingClientRect().width).toBe(24)
    await expect.element(screen.getByText('Copy to…')).not.toBeVisible()
  })

  test('names the action in a tooltip once Copy shrinks to an icon in the narrow header', async () => {
    // Arrange
    const { screen } = await renderHeader({
      skills: [makeCursorSkill(toSkillName('alpha'), 'valid')],
      selectedNames: [toSkillName('alpha')],
      agentId: null,
      onCopyAction: vi.fn(),
      headerWidthPx: NARROW_HEADER_WIDTH_PX,
    })

    // Act
    await screen
      .getByRole('button', { name: 'Copy selected skills to agents' })
      .hover()

    // Assert
    await expect
      .element(screen.getByRole('tooltip'), {
        timeout: TOOLTIP_OPEN_TIMEOUT_MS,
      })
      .toHaveTextContent('Copy selected skills to agents')
  })

  test('truncates a long agent name in the Unlink label instead of wrapping the header', async () => {
    // Arrange
    const agentDisplayName = 'Extremely Long Agent Display Name For Layout'

    // Act
    const { screen } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('beta'), 'valid'),
      ],
      selectedNames: [toSkillName('alpha'), toSkillName('beta')],
      agentId: 'cursor',
      agentDisplayName,
      headerWidthPx: NARROW_HEADER_WIDTH_PX,
    })

    // Assert — one 36px row; the label is clipped, the aria-label is whole
    const header = screen.getByRole('group', { name: 'List header' })
    await expect
      .element(
        screen.getByRole('button', {
          name: `Unlink 2 selected skills from ${agentDisplayName}`,
        }),
      )
      .toBeVisible()
    expect(header.element().getBoundingClientRect().height).toBe(36)
    const label = screen
      .getByText(`Unlink 2 from ${agentDisplayName}`)
      .element()
    expect(label.scrollWidth).toBeGreaterThan(label.clientWidth)
  })

  test('keeps the selected count and the hidden-row number whole when a long agent name crowds the narrow header', async () => {
    // Arrange — 13 ticked in Cursor's view, one of them about to be hidden by
    // the search, so the count, the `+1` note and a long Unlink label compete
    const agentDisplayName = 'Extremely Long Agent Display Name For Layout'
    const visibleNames = Array.from({ length: 12 }, (_, index) =>
      toSkillName(`alpha-${String(index + 1).padStart(2, '0')}`),
    )
    const tickedNames = [...visibleNames, toSkillName('zeta')]
    const { screen, store } = await renderHeader({
      skills: tickedNames.map((name) => makeCursorSkill(name, 'valid')),
      selectedNames: tickedNames,
      agentId: 'cursor',
      agentDisplayName,
      headerWidthPx: NARROW_HEADER_WIDTH_PX,
    })
    const { setSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')

    // Act
    store.dispatch(setSearchQuery(toSearchQuery('alpha')))

    // Assert — the count and `+1` end before the Unlink button starts, and the
    // Unlink label is the one that gave up its room
    const unlinkButton = screen.getByRole('button', {
      name: `Unlink 12 visible selected skills from ${agentDisplayName}`,
    })
    await expect.element(unlinkButton).toBeVisible()
    const unlinkLeft = unlinkButton.element().getBoundingClientRect().left
    const countText = document.createRange()
    countText.selectNodeContents(
      screen.getByText('13 selected', { exact: true }).element(),
    )
    expect(countText.getBoundingClientRect().right).toBeLessThanOrEqual(
      unlinkLeft,
    )
    const hiddenNumber = screen
      .getByText('+1', { exact: true })
      .element()
      .getBoundingClientRect()
    expect(hiddenNumber.width).toBeGreaterThan(0)
    expect(hiddenNumber.right).toBeLessThanOrEqual(unlinkLeft)
    const label = screen
      .getByText(`Unlink 12 from ${agentDisplayName}`)
      .element()
    expect(label.scrollWidth).toBeGreaterThan(label.clientWidth)
    expectInsideHeader(
      screen.getByRole('button', { name: 'Clear selection' }),
      screen.getByRole('group', { name: 'List header' }),
    )
  })

  test('fits the compact header on one 36px row at the 800px window floor in global view', async () => {
    // Arrange
    const skills = [
      makeCursorSkill(toSkillName('alpha'), 'valid'),
      makeCursorSkill(toSkillName('beta'), 'valid'),
    ]

    // Act
    const { screen } = await renderHeader({
      skills,
      selectedNames: [toSkillName('alpha'), toSkillName('beta')],
      agentId: null,
      onCopyAction: vi.fn(),
      headerWidthPx: FLOOR_HEADER_WIDTH_PX,
    })

    // Assert — every control stays inside the single row
    const header = screen.getByRole('group', { name: 'List header' })
    const copyButton = screen.getByRole('button', {
      name: 'Copy selected skills to agents',
    })
    const deleteButton = screen.getByRole('button', {
      name: 'Move 2 selected skills to app trash',
    })
    const clearButton = screen.getByRole('button', { name: 'Clear selection' })
    await expect.element(deleteButton).toBeVisible()
    expect(header.element().getBoundingClientRect().height).toBe(36)
    expectInsideHeader(copyButton, header)
    expectInsideHeader(deleteButton, header)
    expectInsideHeader(clearButton, header)
  })

  test('shortens the visible labels in the compact header while the accessible names stay whole', async () => {
    // Arrange
    const skills = [
      makeCursorSkill(toSkillName('alpha'), 'valid'),
      makeCursorSkill(toSkillName('beta'), 'valid'),
    ]

    // Act
    const { screen } = await renderHeader({
      skills,
      selectedNames: [toSkillName('alpha'), toSkillName('beta')],
      agentId: null,
      onCopyAction: vi.fn(),
      headerWidthPx: FLOOR_HEADER_WIDTH_PX,
    })

    // Assert — `Delete 2` and icon-only Clear, the summary kept for screen readers
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Move 2 selected skills to app trash',
        }),
      )
      .toBeVisible()
    await expect
      .element(screen.getByText('Delete 2', { exact: true }))
      .toBeVisible()
    await expect.element(screen.getByText('Delete 2 skills')).not.toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Clear selection' }))
      .toBeVisible()
    await expect
      .element(screen.getByText('Clear', { exact: true }))
      .not.toBeVisible()
    // The live count's paragraph shrinks to the 1px sr-only box.
    const summaryParagraph = screen
      .getByText('2 selected')
      .element()
      .closest('p')
    expect(summaryParagraph?.getBoundingClientRect().width).toBe(1)
  })

  test('spells out the whole action in the compact primary button tooltip', async () => {
    // Arrange — the compact tier shows only `Delete 2` on the button
    const { screen } = await renderHeader({
      skills: [
        makeCursorSkill(toSkillName('alpha'), 'valid'),
        makeCursorSkill(toSkillName('beta'), 'valid'),
      ],
      selectedNames: [toSkillName('alpha'), toSkillName('beta')],
      agentId: null,
      headerWidthPx: FLOOR_HEADER_WIDTH_PX,
    })

    // Act
    await screen
      .getByRole('button', { name: 'Move 2 selected skills to app trash' })
      .hover()

    // Assert
    await expect
      .element(screen.getByRole('tooltip'), {
        timeout: TOOLTIP_OPEN_TIMEOUT_MS,
      })
      .toHaveTextContent('Move 2 selected skills to app trash')
  })

  test('shortens Unlink to its count in the compact header while the accessible name keeps the agent', async () => {
    // Arrange
    const skills = [
      makeCursorSkill(toSkillName('alpha'), 'valid'),
      makeCursorSkill(toSkillName('beta'), 'valid'),
    ]

    // Act
    const { screen } = await renderHeader({
      skills,
      selectedNames: [toSkillName('alpha'), toSkillName('beta')],
      agentId: 'cursor',
      agentDisplayName: 'Cursor',
      headerWidthPx: FLOOR_HEADER_WIDTH_PX,
    })

    // Assert
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Unlink 2 selected skills from Cursor',
        }),
      )
      .toBeVisible()
    await expect
      .element(screen.getByText('Unlink 2', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('Unlink 2 from Cursor'))
      .not.toBeVisible()
  })
})
