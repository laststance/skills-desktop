import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'

import type { DashboardPage } from './types'
import { newDashboardPageId } from './utils/ids'

/**
 * Build an empty dashboard page with a real branded id so fixtures match
 * production-shaped state the tabs read from the store.
 * @param name - Tab label shown in the page strip.
 * @returns A widget-free DashboardPage usable as preloaded state.
 * @example makePage('Overview').widgets.length // => 0
 */
function makePage(name: string): DashboardPage {
  return {
    id: newDashboardPageId(),
    name,
    widgets: [],
  }
}

/**
 * Render DashboardPageTabs against a real dashboard reducer with preloaded
 * pages. The component reads only dashboard selectors, so a single-slice store
 * is enough. `isEditMode` toggles the edit affordances (+ / dropdown).
 * @param options.pages - Preloaded pages shown as tabs.
 * @param options.currentPageId - Active page id (defaults to first page's id).
 * @param options.isEditMode - Start the bar in edit mode.
 * @returns Browser screen + the Redux store for state assertions.
 */
async function renderTabs(options: {
  pages: DashboardPage[]
  currentPageId?: DashboardPage['id'] | null
  isEditMode?: boolean
}) {
  const [{ default: dashboardReducer }, { DashboardPageTabs }] =
    await Promise.all([
      import('@/renderer/src/redux/slices/dashboardSlice'),
      import('./DashboardPageTabs'),
    ])

  const store = configureStore({
    reducer: { dashboard: dashboardReducer },
    preloadedState: {
      dashboard: {
        pages: options.pages,
        currentPageId:
          options.currentPageId === undefined
            ? (options.pages[0]?.id ?? null)
            : options.currentPageId,
        isEditMode: options.isEditMode ?? false,
        welcomeDismissed: false,
        initialized: true,
      },
    },
  })

  const screen = await render(
    <Provider store={store}>
      <DashboardPageTabs />
    </Provider>,
  )
  return { screen, store }
}

describe('DashboardPageTabs', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hides the bar entirely in view mode when only one page exists', async () => {
    // Arrange: a single page, view mode — nothing to switch between.
    const { screen } = await renderTabs({ pages: [makePage('Solo')] })

    // Act: nothing — the component decides visibility on render.

    // Assert: no tablist is rendered, so the strip takes no chrome space.
    expect(screen.getByRole('tablist').query()).toBeNull()
  })

  it('shows every page as a switchable tab once there are multiple pages', async () => {
    // Arrange: two pages in plain view mode.
    const overview = makePage('Overview')
    const discovery = makePage('Discovery')

    // Act
    const { screen } = await renderTabs({
      pages: [overview, discovery],
      currentPageId: overview.id,
    })

    // Assert: both pages render as tabs and the active one is selected.
    await expect
      .element(screen.getByRole('tab', { name: 'Overview' }))
      .toHaveAttribute('aria-selected', 'true')
    await expect
      .element(screen.getByRole('tab', { name: 'Discovery' }))
      .toHaveAttribute('aria-selected', 'false')
  })

  it('switches the active page when another tab is clicked', async () => {
    // Arrange: start on the first of two pages.
    const overview = makePage('Overview')
    const discovery = makePage('Discovery')
    const { screen, store } = await renderTabs({
      pages: [overview, discovery],
      currentPageId: overview.id,
    })

    // Act: click the second tab.
    await screen.getByRole('tab', { name: 'Discovery' }).click()

    // Assert: the store now points at the clicked page.
    await expect
      .poll(() => store.getState().dashboard.currentPageId)
      .toBe(discovery.id)
  })

  it('shows the bar with an add button in edit mode even for a single page', async () => {
    // Arrange: one page, but edit mode forces the bar to host the "+" button.
    const { screen } = await renderTabs({
      pages: [makePage('Solo')],
      isEditMode: true,
    })

    // Act: nothing — edit mode alone reveals the affordance.

    // Assert: the add-page button is present despite the single page.
    await expect
      .element(screen.getByRole('button', { name: 'Add page' }))
      .toBeVisible()
  })

  it('appends a new page when the add button is clicked in edit mode', async () => {
    // Arrange: one page in edit mode.
    const { screen, store } = await renderTabs({
      pages: [makePage('Solo')],
      isEditMode: true,
    })

    // Act: click the trailing "+" button.
    await screen.getByRole('button', { name: 'Add page' }).click()

    // Assert: a second page was created and became the current selection.
    await expect.poll(() => store.getState().dashboard.pages.length).toBe(2)
    await expect
      .poll(() => store.getState().dashboard.pages[1]?.name)
      .toBe('Page 2')
    await expect
      .poll(() => {
        const dashboard = store.getState().dashboard
        return dashboard.currentPageId === dashboard.pages[1]?.id
      })
      .toBe(true)
  })

  it('moves selection to the previous tab on ArrowLeft and wraps past the first', async () => {
    // Arrange: three pages, active on the middle one.
    const first = makePage('First')
    const second = makePage('Second')
    const third = makePage('Third')
    const { store } = await renderTabs({
      pages: [first, second, third],
      currentPageId: second.id,
    })
    const tablist = document.querySelector('[role="tablist"]')
    if (!(tablist instanceof HTMLElement)) throw new Error('no tablist')

    // Act: ArrowLeft from the middle tab.
    tablist.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      }),
    )

    // Assert: selection moved left to the first page.
    await expect
      .poll(() => store.getState().dashboard.currentPageId)
      .toBe(first.id)

    // Act: ArrowLeft again from the first tab wraps to the last.
    tablist.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      }),
    )

    // Assert: selection wrapped around to the last page.
    await expect
      .poll(() => store.getState().dashboard.currentPageId)
      .toBe(third.id)
  })

  it('moves selection to the next tab on ArrowRight and wraps past the last', async () => {
    // Arrange: three pages, active on the last one.
    const first = makePage('First')
    const second = makePage('Second')
    const third = makePage('Third')
    const { store } = await renderTabs({
      pages: [first, second, third],
      currentPageId: third.id,
    })
    const tablist = document.querySelector('[role="tablist"]')
    if (!(tablist instanceof HTMLElement)) throw new Error('no tablist')

    // Act: ArrowRight from the last tab wraps to the first.
    tablist.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }),
    )

    // Assert: selection wrapped around to the first page.
    await expect
      .poll(() => store.getState().dashboard.currentPageId)
      .toBe(first.id)

    // Act: ArrowRight again advances to the second page.
    tablist.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }),
    )

    // Assert: selection advanced one step.
    await expect
      .poll(() => store.getState().dashboard.currentPageId)
      .toBe(second.id)
  })

  it('jumps to the first and last tab on Home and End', async () => {
    // Arrange: three pages, active on the middle one.
    const first = makePage('First')
    const second = makePage('Second')
    const third = makePage('Third')
    const { store } = await renderTabs({
      pages: [first, second, third],
      currentPageId: second.id,
    })
    const tablist = document.querySelector('[role="tablist"]')
    if (!(tablist instanceof HTMLElement)) throw new Error('no tablist')

    // Act: End jumps to the last page.
    tablist.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'End',
        bubbles: true,
        cancelable: true,
      }),
    )

    // Assert: selection landed on the last page.
    await expect
      .poll(() => store.getState().dashboard.currentPageId)
      .toBe(third.id)

    // Act: Home jumps back to the first page.
    tablist.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Home',
        bubbles: true,
        cancelable: true,
      }),
    )

    // Assert: selection landed on the first page.
    await expect
      .poll(() => store.getState().dashboard.currentPageId)
      .toBe(first.id)
  })

  it('leaves selection untouched for keys that are not navigation keys', async () => {
    // Arrange: two pages, active on the first.
    const overview = makePage('Overview')
    const discovery = makePage('Discovery')
    const { store } = await renderTabs({
      pages: [overview, discovery],
      currentPageId: overview.id,
    })
    const tablist = document.querySelector('[role="tablist"]')
    if (!(tablist instanceof HTMLElement)) throw new Error('no tablist')

    // Act: a non-navigation key (ArrowUp) reaches the keydown handler.
    tablist.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        bubbles: true,
        cancelable: true,
      }),
    )

    // Assert: the active page is unchanged — unrelated keys are ignored.
    await expect
      .poll(() => store.getState().dashboard.currentPageId)
      .toBe(overview.id)
  })

  it('moves keyboard focus to the newly-selected tab after arrow navigation', async () => {
    // Arrange: two pages, active on the first.
    const overview = makePage('Overview')
    const discovery = makePage('Discovery')
    const { screen } = await renderTabs({
      pages: [overview, discovery],
      currentPageId: overview.id,
    })
    const tablist = document.querySelector('[role="tablist"]')
    if (!(tablist instanceof HTMLElement)) throw new Error('no tablist')

    // Act: ArrowRight selects the second tab and defers focus to it.
    tablist.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }),
    )

    // Assert: focus follows the selection so screen readers announce the tab.
    await expect
      .element(screen.getByRole('tab', { name: 'Discovery' }))
      .toHaveFocus()
  })

  it('opens an inline rename input from the tab options menu in edit mode', async () => {
    // Arrange: one page in edit mode (the dropdown only shows in edit mode).
    const { screen } = await renderTabs({
      pages: [makePage('Overview')],
      isEditMode: true,
    })

    // Act: open the tab's options menu, then choose Rename.
    await screen.getByRole('button', { name: 'Options for Overview' }).click()
    await screen.getByRole('menuitem', { name: 'Rename' }).click()

    // Assert: the tab swaps to an editable text field seeded with the name.
    await expect
      .element(screen.getByRole('textbox', { name: 'Rename page Overview' }))
      .toHaveValue('Overview')
  })

  it('commits a changed page name when Enter is pressed in the rename field', async () => {
    // Arrange: open the rename field for the only page.
    const { screen, store } = await renderTabs({
      pages: [makePage('Overview')],
      isEditMode: true,
    })
    await screen.getByRole('button', { name: 'Options for Overview' }).click()
    await screen.getByRole('menuitem', { name: 'Rename' }).click()
    const input = screen.getByRole('textbox', { name: 'Rename page Overview' })

    // Act: replace the text and confirm with Enter.
    await input.fill('Renamed Overview')
    input.element().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    )

    // Assert: the new name is persisted and the field returns to a tab.
    await expect
      .poll(() => store.getState().dashboard.pages[0]?.name)
      .toBe('Renamed Overview')
    await expect
      .element(screen.getByRole('tab', { name: 'Renamed Overview' }))
      .toBeVisible()
  })

  it('discards the rename and keeps the original name when Escape is pressed', async () => {
    // Arrange: open the rename field for the only page.
    const { screen, store } = await renderTabs({
      pages: [makePage('Overview')],
      isEditMode: true,
    })
    await screen.getByRole('button', { name: 'Options for Overview' }).click()
    await screen.getByRole('menuitem', { name: 'Rename' }).click()
    const input = screen.getByRole('textbox', { name: 'Rename page Overview' })

    // Act: type a throwaway edit, then cancel with Escape.
    await input.fill('Throwaway edit')
    input.element().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    )

    // Assert: the original name survives and the tab is restored.
    await expect
      .element(screen.getByRole('tab', { name: 'Overview' }))
      .toBeVisible()
    await expect
      .poll(() => store.getState().dashboard.pages[0]?.name)
      .toBe('Overview')
  })

  it('deletes the page after the confirm prompt is accepted', async () => {
    // Arrange: two pages in edit mode so the delete item is offered.
    const overview = makePage('Overview')
    const discovery = makePage('Discovery')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { screen, store } = await renderTabs({
      pages: [overview, discovery],
      currentPageId: overview.id,
      isEditMode: true,
    })

    // Act: open the first tab's menu and choose Delete (confirm returns true).
    await screen.getByRole('button', { name: 'Options for Overview' }).click()
    await screen.getByRole('menuitem', { name: 'Delete' }).click()

    // Assert: the user was warned and the page was removed from the store.
    expect(confirmSpy).toHaveBeenCalledOnce()
    await expect.poll(() => store.getState().dashboard.pages.length).toBe(1)
    expect(store.getState().dashboard.pages[0]?.name).toBe('Discovery')
  })
})
