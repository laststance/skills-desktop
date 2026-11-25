import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import '@/renderer/src/styles/globals.css'
import type { Skill } from '@/shared/types'
import {
  repositoryId,
  toAbsolutePath,
  toHttpUrl,
  toSearchQuery,
  toSkillName,
  toSymlinkCount,
} from '@/shared/types'

const mockGetAll = vi.fn()

/** The list column in the 800px minimum window at the default split: (800 - 272px sidebar) / 2. */
const MIN_WINDOW_LIST_COLUMN_WIDTH_PX = 264

beforeEach(() => {
  // Stub the IPC bridge so the SkillsList useEffect dispatch of fetchSkills
  // does not throw. The thunk fires on mount; tests assert the *render branch*
  // chosen from preloadedState, so the resolved value here is irrelevant.
  vi.stubGlobal('electron', {
    skills: {
      getAll: mockGetAll.mockResolvedValue([]),
      onDeleteProgress: vi.fn(() => (): void => {}),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build a minimal Skill fixture matching `selectFilteredSkills`'s default
 * branch (no agent selected → keeps `isSource: true` items).
 * @param overrides - Partial Skill overrides
 * @returns Complete Skill object
 * @example makeSkill({ name: toSkillName('task') })
 */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: toSkillName('task'),
    description: 'Task management skill',
    path: toAbsolutePath('/home/user/.agents/skills/task'),
    symlinkCount: toSymlinkCount(0),
    symlinks: [],
    isSource: true,
    isOrphan: false,
    ...overrides,
  }
}

/**
 * Build a combined store with the slices SkillsList reads, seeded via
 * `preloadedState` so we can simulate `loading=true` while items already
 * contains data — the exact state hit during background refetch after a
 * mutation (Add/Delete/Unlink etc).
 * @param skillsState - Partial skills slice override (loading, items)
 * @returns Redux store
 */
async function createStore(
  skillsState: { loading?: boolean; items?: Skill[] } = {},
) {
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { default: bookmarkReducer } =
    await import('@/renderer/src/redux/slices/bookmarkSlice')
  const { default: protectReducer } =
    await import('@/renderer/src/redux/slices/protectSlice')

  // Build a complete SkillsState that satisfies the slice's typing while
  // letting tests override only the two fields that matter for the render
  // branch (loading, items). Other slices are omitted from preloadedState
  // so they fall back to each reducer's own initialState — this avoids
  // re-declaring shapes that aren't exported.
  return configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
      agents: agentsReducer,
      bookmarks: bookmarkReducer,
      protect: protectReducer,
    },
    preloadedState: {
      skills: {
        items: skillsState.items ?? [],
        selectedSkill: null,
        filesGeneration: 0,
        inspectedFile: null,
        inspectorTabOverride: null,
        loading: skillsState.loading ?? false,
        error: null,
        skillToUnlink: null,
        unlinking: false,
        skillToAddSymlinks: null,
        selectedAddAgentIds: [],
        addingSymlinks: false,
        skillToCopy: null,
        selectedCopyAgentIds: [],
        copying: false,
        selectedSkillNames: [],
        selectionAnchor: null,
        inFlightDeleteNames: [],
        inFlightUnlinkNames: [],
        bulkDeleting: false,
        bulkUnlinking: false,
        bulkCopying: false,
        bulkCopyModalOpen: false,
        bulkProgress: null,
      },
    },
  })
}

/**
 * Render SkillsList inside the provider stack it needs. The fixed-height
 * outer div lets react-window v2 measure a non-zero viewport so virtualized
 * rows actually mount; without it, rowCount > 0 but no rows are rendered.
 * @returns vitest-browser-react screen for locator queries
 */
async function renderSkillsList(skillsState: {
  loading?: boolean
  items?: Skill[]
}) {
  const store = await createStore(skillsState)
  const { SkillsList } = await import('./SkillsList')
  return render(
    <Provider store={store}>
      <TooltipProvider>
        <div style={{ height: 600, width: 800 }}>
          <SkillsList />
        </div>
      </TooltipProvider>
    </Provider>,
  )
}

/**
 * Render SkillsList in the same scroll shell used by the Installed tab.
 * @param skillsState - Skill slice fields needed for the visible rows.
 * @param widthPx - Width of the list column; defaults to a roomy 800px.
 * @returns vitest-browser-react screen for locator queries.
 * @example
 * await renderInstalledListShell({ items: [makeSkill()] })
 * await renderInstalledListShell({ items: [makeSkill()] }, MIN_WINDOW_LIST_COLUMN_WIDTH_PX)
 */
async function renderInstalledListShell(
  skillsState: {
    loading?: boolean
    items?: Skill[]
  },
  widthPx = 800,
) {
  const store = await createStore(skillsState)
  const { SkillsList } = await import('./SkillsList')
  return render(
    <Provider store={store}>
      <TooltipProvider>
        <div
          data-testid="installed-list-shell"
          className="overflow-hidden py-4 pl-4 pr-[5px]"
          style={{ height: 360, width: widthPx }}
        >
          <SkillsList />
        </div>
      </TooltipProvider>
    </Provider>,
  )
}

/**
 * Require a DOM node to be an HTMLElement before layout measurement.
 * @param element - Candidate node from querySelector or closest.
 * @param label - Human-readable selector name for failure output.
 * @returns HTMLElement safe for getBoundingClientRect measurement.
 * @example
 * const card = requireHTMLElement(document.querySelector('.group'), 'card')
 */
function requireHTMLElement(
  element: Element | null,
  label: string,
): HTMLElement {
  if (!(element instanceof HTMLElement)) {
    throw new Error(`${label} should exist for layout measurement`)
  }
  return element
}

/**
 * Measure the Installed list card and reserved scrollbar gutter geometry.
 * @param deleteButtonAriaLabel - Exact aria-label for the row delete button.
 * @param cardLabel - Human-readable card label for failure output.
 * @returns DOM list element plus rounded gutter and spacing metrics.
 * @example
 * const metrics = measureInstalledListLayout('Delete skill-0', 'first skill card')
 */
function measureInstalledListLayout(
  deleteButtonAriaLabel: string,
  cardLabel: string,
) {
  const shell = requireHTMLElement(
    document.querySelector('[data-testid="installed-list-shell"]'),
    'installed list shell',
  )
  const list = requireHTMLElement(
    document.querySelector('[role="list"]'),
    'virtualized list',
  )
  const deleteButton = requireHTMLElement(
    Array.from(document.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === deleteButtonAriaLabel,
    ) ?? null,
    `${cardLabel} delete button`,
  )
  const card = requireHTMLElement(deleteButton.closest('.group'), cardLabel)
  const shellRect = shell.getBoundingClientRect()
  const listRect = list.getBoundingClientRect()
  const cardRect = card.getBoundingClientRect()
  const reservedGutterWidthPx = list.offsetWidth - list.clientWidth
  const reservedGutterLeftPx = listRect.right - reservedGutterWidthPx

  return {
    list,
    reservedGutterWidthPx,
    leftGutterPx: Math.round(cardRect.left - shellRect.left),
    rightGutterPx: Math.round(shellRect.right - cardRect.right),
    reservedGutterLeftSpacingPx: Math.round(
      reservedGutterLeftPx - cardRect.right,
    ),
    reservedGutterRightSpacingPx: Math.round(shellRect.right - listRect.right),
  }
}

describe('SkillsList loading branch — scroll-preservation regression', () => {
  test('shows the "Loading skills..." placeholder on initial fetch (loading=true, items=[])', async () => {
    // Arrange
    // Pin getAll on a never-resolving promise so the on-mount fetchSkills
    // useEffect cannot flip loading→false before the assertion polls the
    // DOM. Without this the fulfilled reducer would land first and the
    // empty-list branch ("No skills installed") would replace the
    // placeholder — a flake unrelated to the bug under test.
    mockGetAll.mockReturnValue(new Promise(() => {}))

    // Act
    const screen = await renderSkillsList({ loading: true, items: [] })

    // Assert
    await expect
      .element(screen.getByText('Loading skills...'))
      .toBeInTheDocument()
  })

  test('keeps the list mounted during background refetch (loading=true, items=[skill])', async () => {
    // Arrange
    // Background refetch after a mutation: Redux flips loading=true while
    // items still contain the previous data. The `loading && skills.length === 0`
    // guard ensures the existing <List> stays mounted so react-window's
    // internal scrollTop survives. If a future change reverts to `if (loading)`
    // the list unmounts and the placeholder shows — this assertion catches that regression.
    mockGetAll.mockReturnValue(new Promise(() => {}))

    // Act
    const screen = await renderSkillsList({
      loading: true,
      items: [makeSkill({ name: toSkillName('task') })],
    })

    // Assert
    expect(screen.getByText('Loading skills...').query()).toBeNull()
  })
})

describe('SkillsList scrollbar gutter layout', () => {
  test('keeps installed skill cards and scrollbar spacing balanced when the vertical scrollbar is visible', async () => {
    // Arrange
    mockGetAll.mockReturnValue(new Promise(() => {}))
    const visibleSkills = Array.from({ length: 8 }, (_value, index) =>
      makeSkill({
        name: toSkillName(`skill-${index}`),
        description: `Skill ${index} with enough body copy to use the normal installed card height.`,
      }),
    )

    // Act
    const screen = await renderInstalledListShell({ items: visibleSkills })
    await expect.element(screen.getByText('skill-0')).toBeVisible()

    // Assert
    const metrics = measureInstalledListLayout(
      'Delete skill-0',
      'first skill card',
    )

    expect(metrics.reservedGutterWidthPx).toBe(6)
    expect(metrics.leftGutterPx).toBe(16)
    expect(metrics.rightGutterPx).toBe(16)
    expect(metrics.reservedGutterLeftSpacingPx).toBe(5)
    expect(metrics.reservedGutterRightSpacingPx).toBe(5)
  })

  test('keeps installed skill cards and reserved scrollbar gutter balanced when vertical scrolling is unnecessary', async () => {
    // Arrange
    mockGetAll.mockReturnValue(new Promise(() => {}))
    const visibleSkills = [
      makeSkill({
        name: toSkillName('single-skill'),
        description: 'A short list should not need vertical scrolling.',
      }),
    ]

    // Act
    const screen = await renderInstalledListShell({ items: visibleSkills })
    await expect.element(screen.getByText('single-skill')).toBeVisible()

    // Assert
    const metrics = measureInstalledListLayout(
      'Delete single-skill',
      'single skill card',
    )

    expect(metrics.list.scrollHeight).toBeLessThanOrEqual(
      metrics.list.clientHeight,
    )
    expect(metrics.reservedGutterWidthPx).toBe(6)
    expect(metrics.leftGutterPx).toBe(16)
    expect(metrics.rightGutterPx).toBe(16)
    expect(metrics.reservedGutterLeftSpacingPx).toBe(5)
    expect(metrics.reservedGutterRightSpacingPx).toBe(5)
  })
})

describe('personal bookmark categories in Installed', () => {
  async function renderCollection(names: string[]) {
    mockGetAll.mockReturnValue(new Promise(() => {}))
    const store = await createStore({
      items: names.map((name) => makeSkill({ name: toSkillName(name) })),
    })
    const { SkillsList } = await import('./SkillsList')
    const { BookmarkCategoryFilter } =
      await import('../bookmarks/BookmarkCategoryFilter')
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <BookmarkCategoryFilter surface="installed" />
          <div style={{ width: 450, height: 400 }}>
            <SkillsList />
          </div>
        </TooltipProvider>
      </Provider>,
    )
    return { store, screen }
  }

  test('saving before classification, editing a custom color and canceling a used deletion preserve the source', async () => {
    // Arrange
    const { screen, store } = await renderCollection(['audit'])
    const card = screen.getByRole('button', {
      name: 'Bookmark audit',
      exact: true,
    })

    // Act
    await card.click()
    await expect
      .element(screen.getByRole('menu', { name: 'Category for audit' }))
      .toBeVisible()
    await userEvent.keyboard('{Escape}')
    expect(store.getState().bookmarks.items[0].categoryId).toBeUndefined()
    const savedUrl = store.getState().bookmarks.items[0].url
    await screen
      .getByRole('button', { name: 'Set category', exact: true })
      .click()
    await screen.getByRole('menuitem', { name: 'New category' }).click()
    await expect
      .element(screen.getByRole('radio', { name: 'Blue', exact: true }))
      .toBeChecked()
    await screen.getByRole('textbox', { name: 'Name' }).fill(' Uncategorized ')
    await screen.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('This name is used by the category filter.')
    await screen.getByRole('textbox', { name: 'Name' }).fill('Audit tools')
    await screen.getByRole('radio', { name: 'Teal', exact: true }).click()
    await screen.getByRole('button', { name: 'Apply', exact: true }).click()
    const trigger = screen.getByRole('button', {
      name: 'Audit tools',
      exact: true,
    })
    await expect.element(trigger).toBeVisible()
    await trigger.click()
    await screen.getByRole('menuitem', { name: 'Edit Audit tools' }).click()
    await screen.getByRole('button', { name: 'Delete category' }).click()
    await expect
      .element(
        screen.getByText(
          'Deleting Audit tools makes 1 bookmark uncategorized. Your bookmarks will stay saved.',
        ),
      )
      .toBeVisible()
    await screen.getByRole('button', { name: 'Cancel', exact: true }).click()
    await screen.getByRole('button', { name: 'Cancel', exact: true }).click()

    // Assert
    await expect.element(trigger).toBeVisible()
    expect(store.getState().bookmarks.items[0].url).toBe(savedUrl)
    expect(store.getState().bookmarks.categories.at(-1)).toMatchObject({
      name: 'Audit tools',
      color: 'teal',
    })
  })

  test('a linked agent card accepts keyboard bookmarking, multiword category names, swatches, and removal', async () => {
    // Arrange
    const { store, screen } = await renderCollection(['audit'])
    const { fetchSkills } = await import('../../redux/slices/skillsSlice')
    const { selectAgent } = await import('../../redux/slices/uiSlice')
    const skill = makeSkill({
      name: toSkillName('audit'),
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          isLocal: false,
          linkPath: toAbsolutePath('/home/user/.cursor/skills/audit'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/audit'),
        },
      ],
    })
    store.dispatch(fetchSkills.fulfilled([skill], 'agent-scan'))
    store.dispatch(selectAgent('cursor'))
    const bookmark = screen.getByRole('button', {
      name: 'Bookmark audit',
      exact: true,
    })
    await expect.element(bookmark).toBeVisible()

    // Act — each activation goes through the actual key event and native button behavior.
    bookmark.element().focus()
    await userEvent.keyboard('{Enter}')
    const newCategory = screen.getByRole('menuitem', { name: 'New category' })
    await expect.element(newCategory).toBeVisible()
    newCategory.element().focus()
    await userEvent.keyboard('{Enter}')
    const name = screen.getByRole('textbox', { name: 'Name' })
    await expect.element(name).toHaveFocus()
    await userEvent.keyboard('Review tools')
    await expect.element(name).toHaveValue('Review tools')
    const initialColor = screen.getByRole('radio', {
      name: 'Blue',
      exact: true,
    })
    initialColor.element().focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(initialColor).not.toBeChecked()
    name.element().focus()
    await userEvent.keyboard('{Enter}')

    // Assert — saving and removing the bookmark also handle the outer card's menu.
    await expect
      .element(
        screen.getByRole('button', { name: 'Review tools', exact: true }),
      )
      .toBeVisible()
    const remove = screen.getByRole('button', {
      name: 'Remove bookmark from audit',
    })
    remove.element().focus()
    await userEvent.keyboard(' ')
    await expect.element(bookmark).toBeVisible()
    expect(store.getState().bookmarks.items).toEqual([])
  })

  test('an empty installation can clear its category filter and return to the first-install hint', async () => {
    // Arrange
    const { store, screen } = await renderCollection([])
    const { fetchSkills } = await import('../../redux/slices/skillsSlice')
    const { setBookmarkCategoryFilter } =
      await import('../../redux/slices/uiSlice')
    store.dispatch(fetchSkills.fulfilled([], 'empty-scan'))

    // Act
    store.dispatch(
      setBookmarkCategoryFilter({ surface: 'installed', id: 'security' }),
    )
    await screen.getByRole('button', { name: 'Clear category filter' }).click()

    // Assert
    await expect.element(screen.getByText('No skills installed')).toBeVisible()
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Installed category filter: All categories',
        }),
      )
      .toBeVisible()
  })

  test('deleting an unused starter is immediate and confirming a used starter counts saved skills that were uninstalled', async () => {
    // Arrange
    const { store, screen } = await renderCollection(['audit'])
    const { addBookmark, assignBookmarkCategory } =
      await import('../../redux/slices/bookmarkSlice')
    for (const name of ['audit', 'removed-skill']) {
      store.dispatch(
        addBookmark({
          name: toSkillName(name),
          repo: '',
          url: toHttpUrl('https://example.test/original'),
        }),
      )
      store.dispatch(
        assignBookmarkCategory({
          name: toSkillName(name),
          categoryId: 'security',
        }),
      )
    }
    const trigger = screen.getByRole('button', {
      name: 'Security',
      exact: true,
    })

    // Act
    await trigger.click()
    await screen.getByRole('menuitem', { name: 'Edit Planning' }).click()
    await screen.getByRole('button', { name: 'Delete category' }).click()
    expect(
      store
        .getState()
        .bookmarks.categories.some((category) => category.id === 'planning'),
    ).toBe(false)
    await trigger.click()
    await screen.getByRole('menuitem', { name: 'Edit Security' }).click()
    const field = screen.getByRole('textbox', { name: 'Name' })
    await field.fill('  aLL caTEGOries  ')
    await screen.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect.element(field).toHaveValue('  aLL caTEGOries  ')
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('This name is used by the category filter.')
    expect(
      store
        .getState()
        .bookmarks.items.every((item) => item.categoryId === 'security'),
    ).toBe(true)
    await screen.getByRole('button', { name: 'Delete category' }).click()
    await expect
      .element(
        screen.getByText(
          'Deleting Security makes 2 bookmarks uncategorized. Your bookmarks will stay saved.',
        ),
      )
      .toBeVisible()
    await screen.getByRole('button', { name: 'Delete category' }).click()

    // Assert
    await expect
      .element(
        screen.getByRole('button', { name: 'Set category', exact: true }),
      )
      .toBeVisible()
    expect(
      store
        .getState()
        .bookmarks.items.map((item) => [item.name, item.url, item.categoryId]),
    ).toEqual([
      ['audit', 'https://example.test/original', undefined],
      ['removed-skill', 'https://example.test/original', undefined],
    ])
  })

  // Generated by /ship. Value: protects=keyboard use continues on an initially offscreen successor;
  // fails_when=focus is lost after removing the bottom visible card; why_new=three-row fixtures never scroll;
  // seam=none; no_claim=Electron window focus (real Chromium with a mocked scan).
  test('opens the next initially offscreen category by keyboard after removing the bottom visible bookmark', async () => {
    // Arrange
    const names = Array.from(
      { length: 30 },
      (_, i) => 'audit-' + String(i).padStart(2, '0'),
    )
    const { store, screen } = await renderCollection(names)
    const { addBookmark } = await import('../../redux/slices/bookmarkSlice')
    const { setBookmarkCategoryFilter } =
      await import('../../redux/slices/uiSlice')
    for (const name of names) {
      store.dispatch(
        addBookmark({
          name: toSkillName(name),
          repo: '',
          url: toHttpUrl('https://example.test'),
        }),
      )
    }
    store.dispatch(
      setBookmarkCategoryFilter({ surface: 'installed', id: 'uncategorized' }),
    )
    const list = screen.getByRole('list').element()
    const firstRow = list.firstElementChild!
    list.scrollTop =
      firstRow.getBoundingClientRect().height * 11 - list.clientHeight
    const remove = screen.getByRole('button', {
      name: 'Remove bookmark from audit-10',
    })
    await expect.element(remove).toBeVisible()
    const successor = screen.getByRole('button', {
      name: 'Remove bookmark from audit-11',
    })
    expect(
      successor.element().getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(list.getBoundingClientRect().bottom)

    // Act
    ;(remove.element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')

    // Assert
    await expect
      .poll(() => document.activeElement?.getAttribute('data-category-for'))
      .toBe('audit-11')
    await userEvent.keyboard('{Enter}')
    await expect
      .element(screen.getByRole('menu', { name: 'Category for audit-11' }))
      .toBeVisible()
    expect(store.getState().bookmarks.items).toHaveLength(29)
  })

  test.each([
    { operation: 'unbookmark', filter: 'security' },
    { operation: 'reclassify', filter: 'security' },
    { operation: 'unbookmark', filter: 'uncategorized' },
    { operation: 'reclassify', filter: 'uncategorized' },
  ])(
    'keyboard $operation in $filter recovers at the next category, previous category or empty filter',
    async ({ operation, filter }) => {
      // Arrange
      const { store, screen } = await renderCollection([
        'alpha',
        'bravo',
        'charlie',
      ])
      const { addBookmark, assignBookmarkCategory } =
        await import('../../redux/slices/bookmarkSlice')
      const { setBookmarkCategoryFilter } =
        await import('../../redux/slices/uiSlice')
      for (const name of ['alpha', 'bravo', 'charlie']) {
        store.dispatch(
          addBookmark({
            name: toSkillName(name),
            repo: '',
            url: toHttpUrl('https://example.test'),
          }),
        )
        if (filter === 'security')
          store.dispatch(
            assignBookmarkCategory({
              name: toSkillName(name),
              categoryId: 'security',
            }),
          )
      }
      store.dispatch(
        setBookmarkCategoryFilter({ surface: 'installed', id: filter }),
      )
      await expect
        .element(
          screen
            .getByRole('button', {
              name: filter === 'security' ? 'Security' : 'Set category',
              exact: true,
            })
            .first(),
        )
        .toBeVisible()
      // Act and assert after each disappearance, using real keyboard events against the rendered card.
      for (const [name, next] of [
        ['bravo', 'charlie'],
        ['charlie', 'alpha'],
        ['alpha', ''],
      ]) {
        const button = document.querySelector<HTMLButtonElement>(
          operation === 'unbookmark'
            ? `[aria-label="Remove bookmark from ${name}"]`
            : `[data-category-for="${name}"]`,
        )
        if (!button)
          throw new Error('Missing visible bookmark action for ' + name)
        button.focus()
        await userEvent.keyboard('{Enter}')
        if (operation === 'reclassify') {
          const planning = screen.getByRole('menuitem', {
            name: 'Planning',
            exact: true,
          })
          await expect.element(planning).toBeVisible()
          ;(planning.element() as HTMLElement).focus()
          await userEvent.keyboard('{Enter}')
        }
        await expect
          .poll(() =>
            next
              ? document.activeElement?.getAttribute('data-category-for')
              : document.activeElement?.id,
          )
          .toBe(next || 'installed-bookmark-category-filter')
      }
      await expect
        .element(screen.getByRole('button', { name: 'Clear category filter' }))
        .toBeVisible()
      expect(store.getState().ui.installedCategoryFilter).toBe(filter)
    },
  )
})

describe('SkillsList global card spacing', () => {
  test('keeps the full 20px gap between a Local source label and the status badges instead of collapsing it to 12px', async () => {
    // Arrange
    mockGetAll.mockReturnValue(new Promise(() => {}))
    // No `source`, so SourceLink renders the block "Local" label, whose mb-2
    // sits right above the status badges.
    const localSkill = makeSkill({
      name: toSkillName('local-skill'),
      description: 'A skill with no recorded source repository.',
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'valid',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/local-skill'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/local-skill'),
          isLocal: false,
        },
      ],
    })

    // Act
    const screen = await renderInstalledListShell({ items: [localSkill] })
    const localLabel = screen.getByText('Local', { exact: true })
    const validBadge = screen.getByLabelText('Valid: 1')
    await expect.element(localLabel).toBeVisible()
    await expect.element(validBadge).toBeVisible()

    // Assert
    // The label's 8px mb-2 plus the badge row's 12px top spacing. If that
    // spacing were a margin, the two would collapse to 12px and the card
    // would lose 8px of the row slot {@link SkillsList} reserves for it.
    const gapPx = Math.round(
      validBadge.element().getBoundingClientRect().top -
        localLabel.element().getBoundingClientRect().bottom,
    )
    expect(gapPx).toBe(20)
  })

  test('keeps the "Not linked to any agent" note on one line in the minimum window, so the card does not outgrow its row slot', async () => {
    // Arrange
    mockGetAll.mockReturnValue(new Promise(() => {}))
    const unlinkedSkill = makeSkill({
      name: toSkillName('unlinked-skill'),
      description: 'A skill no agent links to yet.',
      symlinks: [],
    })

    // Act
    const screen = await renderInstalledListShell(
      { items: [unlinkedSkill] },
      MIN_WINDOW_LIST_COLUMN_WIDTH_PX,
    )
    const unlinkedNote = screen.getByText('Not linked to any agent')
    await expect.element(unlinkedNote).toBeVisible()

    // Assert
    // One text-xs line is 16px tall; a wrapped note would be 32px.
    expect(
      Math.round(unlinkedNote.element().getBoundingClientRect().height),
    ).toBe(16)
  })

  test('keeps a linked source repository on one line in the minimum window, so the card does not overlap the next one', async () => {
    // Arrange
    mockGetAll.mockReturnValue(new Promise(() => {}))
    const repositorySkill = makeSkill({
      name: toSkillName('repository-skill'),
      description: 'A skill installed from a GitHub repository.',
      source: repositoryId('vercel-labs/skills'),
      sourceUrl: toHttpUrl('https://github.com/vercel-labs/skills.git'),
    })

    // Act
    const screen = await renderInstalledListShell(
      { items: [repositorySkill] },
      MIN_WINDOW_LIST_COLUMN_WIDTH_PX,
    )
    const sourceButton = screen.getByRole('button', {
      name: 'Filter skills by repository vercel-labs/skills',
    })
    await expect.element(sourceButton).toBeVisible()

    // Assert
    // One text-sm line is 20px tall; a wrapped repository name would be 40px
    // and push the card 20px past the row slot {@link SkillsList} computes.
    expect(
      Math.round(sourceButton.element().getBoundingClientRect().height),
    ).toBe(20)
  })

  test('keeps a source repository without a URL on one line in the minimum window, so the card does not overlap the next one', async () => {
    // Arrange
    mockGetAll.mockReturnValue(new Promise(() => {}))
    const repositorySkill = makeSkill({
      name: toSkillName('repository-skill'),
      description: 'A skill whose repository has no browsable URL.',
      source: repositoryId('vercel-labs/skills'),
    })

    // Act
    const screen = await renderInstalledListShell(
      { items: [repositorySkill] },
      MIN_WINDOW_LIST_COLUMN_WIDTH_PX,
    )
    const sourceLabel = screen.getByText('vercel-labs/skills', { exact: true })
    await expect.element(sourceLabel).toBeVisible()

    // Assert
    // One text-sm line is 20px tall; a wrapped repository name would be 40px.
    expect(
      Math.round(sourceLabel.element().getBoundingClientRect().height),
    ).toBe(20)
  })
})

describe('SkillsList fetch-failure branch', () => {
  test('surfaces the fetch error message instead of the skills list when the scan fails', async () => {
    // Arrange
    // Drive the real terminal state: the on-mount fetchSkills must REJECT so the
    // rejected reducer lands loading=false + error=<message>. Pinning a pending
    // promise would instead trap the loading guard (loading && items.length===0)
    // and the placeholder, never the error, would show. The error branch must
    // win over the empty-installed render so the user learns the scan failed.
    mockGetAll.mockRejectedValue(new Error('Failed to scan skills directory'))

    // Act
    const screen = await renderSkillsList({})

    // Assert
    await expect
      .element(screen.getByText('Failed to scan skills directory'))
      .toBeInTheDocument()
  })
})

describe('SkillsList failed-row flash', () => {
  /**
   * Read whether a row's card shows the red failed-row edge.
   * @param skillName - The row's skill name.
   * @returns Whether the card carries the red edge class.
   * @example isRowFlashingRed('beta') // => true right after flashFailedRows(['beta'])
   */
  function isRowFlashingRed(skillName: string): boolean {
    const card = document.querySelector(`[data-skill-name="${skillName}"]`)
    return Boolean(card?.className.includes('border-l-red-500/70'))
  }

  test('keeps the red edge on the failed skill when a refresh removes the row above it', async () => {
    // Arrange — three rows, and the middle one failed its bulk op. The on-mount
    // fetch never settles, so only the dispatched refresh below changes rows.
    mockGetAll.mockReturnValue(new Promise(() => {}))
    const alpha = makeSkill({
      name: toSkillName('alpha'),
      path: toAbsolutePath('/home/user/.agents/skills/alpha'),
    })
    const beta = makeSkill({
      name: toSkillName('beta'),
      path: toAbsolutePath('/home/user/.agents/skills/beta'),
    })
    const gamma = makeSkill({
      name: toSkillName('gamma'),
      path: toAbsolutePath('/home/user/.agents/skills/gamma'),
    })
    const store = await createStore({ items: [alpha, beta, gamma] })
    const { SkillsList } = await import('./SkillsList')
    const { fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { flashFailedRows } =
      await import('@/renderer/src/utils/bulkOpVisuals')
    await render(
      <Provider store={store}>
        <TooltipProvider>
          <div style={{ height: 600, width: 800 }}>
            <SkillsList />
          </div>
        </TooltipProvider>
      </Provider>,
    )
    await expect.poll(() => isRowFlashingRed('beta')).toBe(false)
    flashFailedRows([toSkillName('beta')])
    await expect.poll(() => isRowFlashingRed('beta')).toBe(true)

    // Act — the refresh drops the deleted alpha row, so beta moves up a slot
    store.dispatch(fetchSkills.fulfilled([beta, gamma], 'refresh-req'))
    await expect
      .poll(() => document.querySelector('[data-skill-name="alpha"]'))
      .toBeNull()

    // Assert — the edge moved with beta instead of staying on the slot
    expect(isRowFlashingRed('beta')).toBe(true)
    expect(isRowFlashingRed('gamma')).toBe(false)
  })

  test('paints the red edge on a failed row once the list comes back from a rejected bulk op error view', async () => {
    // Arrange — a rejected bulk op swaps the list for its error view, so the
    // rows are unmounted when MainContent flashes the attempted ones
    mockGetAll.mockReturnValue(new Promise(() => {}))
    const store = await createStore({
      items: [makeSkill({ name: toSkillName('task') })],
    })
    const { SkillsList } = await import('./SkillsList')
    const { deleteSelectedSkills, fetchSkills } =
      await import('@/renderer/src/redux/slices/skillsSlice')
    const { flashFailedRows } =
      await import('@/renderer/src/utils/bulkOpVisuals')
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <div style={{ height: 600, width: 800 }}>
            <SkillsList />
          </div>
        </TooltipProvider>
      </Provider>,
    )
    store.dispatch(
      deleteSelectedSkills.rejected(
        new Error('Socket closed'),
        'delete-req',
        [],
      ),
    )
    await expect.element(screen.getByText('Socket closed')).toBeVisible()
    flashFailedRows([toSkillName('task')])

    // Act — the refresh that follows clears the error and remounts the rows
    store.dispatch(fetchSkills.pending('refresh-req'))

    // Assert — the remounted row shows the rest of the flash
    await expect.poll(() => isRowFlashingRed('task')).toBe(true)
  })
})

describe('SkillsList empty-installed branch', () => {
  test('shows the install hint when no skills are installed at all', async () => {
    // Arrange
    // Drive the real terminal state: the on-mount fetchSkills must RESOLVE with
    // [] so the fulfilled reducer lands loading=false + items=[] with no error.
    // No agent, no filters, no error, not loading, zero items → onboarding empty
    // state. A pinned pending promise would trap the loading placeholder instead.
    mockGetAll.mockResolvedValue([])

    // Act
    const screen = await renderSkillsList({})

    // Assert
    await expect
      .element(screen.getByText('No skills installed'))
      .toBeInTheDocument()
  })
})

describe('SkillsList search-empty branch', () => {
  test('search-miss empty state renders SearchX icon, echoed query, and Clear search button', async () => {
    // Arrange — one installed skill; never-resolving getAll keeps preloadedState
    // items intact so we stay out of the "No skills installed" branch.
    mockGetAll.mockReturnValue(new Promise(() => {}))
    const store = await createStore({
      items: [makeSkill({ name: toSkillName('git-workflow') })],
    })
    const { setSearchQuery: dispatchSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')
    // Dispatch before render so the component mounts with the query already set
    store.dispatch(dispatchSearchQuery(toSearchQuery('  zzznomatch  ')))
    const { SkillsList } = await import('./SkillsList')
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <div style={{ height: 600, width: 800 }}>
            <SkillsList />
          </div>
        </TooltipProvider>
      </Provider>,
    )

    // Assert — SearchX icon placeholder, echoed query, and clear CTA present
    await expect
      .element(
        screen.getByText('No skills match “zzznomatch”', { exact: true }),
      )
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Clear search' }))
      .toBeVisible()
  })

  test('clicking Clear search clears the search query and exits the search-miss state', async () => {
    // Arrange — one installed skill with an active search that matches nothing
    mockGetAll.mockReturnValue(new Promise(() => {}))
    const store = await createStore({
      items: [makeSkill({ name: toSkillName('git-workflow') })],
    })
    const { setSearchQuery: dispatchSearchQuery } =
      await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(dispatchSearchQuery(toSearchQuery('zzznomatch')))
    const { SkillsList } = await import('./SkillsList')
    const screen = await render(
      <Provider store={store}>
        <TooltipProvider>
          <div style={{ height: 600, width: 800 }}>
            <SkillsList />
          </div>
        </TooltipProvider>
      </Provider>,
    )
    await expect
      .element(screen.getByRole('button', { name: 'Clear search' }))
      .toBeInTheDocument()

    // Act
    await screen.getByRole('button', { name: 'Clear search' }).click()

    // Assert — search query cleared in Redux and search-miss state no longer rendered
    expect(store.getState().ui.searchQuery).toBe('')
    expect(screen.getByText(/No skills match/).query()).toBeNull()
  })
})

describe('SkillsList filtered-empty branch', () => {
  test('explains that no skills match the active filter when every installed skill is filtered out', async () => {
    // Arrange
    // Drive the real terminal state: the on-mount fetchSkills must RESOLVE with
    // one isSource:false skill so the fulfilled reducer lands it into items. With
    // no agent selected, selectFilteredSkills keeps only isSource:true rows, so
    // items is non-empty but filteredSkills is empty — the exact gap between the
    // empty-installed and the rendered list. Default UI filters (no search, no
    // source, no agent, type=all) make getEmptyListMessage fall to its catch-all.
    mockGetAll.mockResolvedValue([
      makeSkill({ name: toSkillName('hidden-skill'), isSource: false }),
    ])

    // Act
    const screen = await renderSkillsList({})

    // Assert
    await expect
      .element(screen.getByText('No skills match your filter'))
      .toBeInTheDocument()
  })
})
