import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { type HttpUrl, type RepositoryId, repositoryId } from '@/shared/types'

const REPO = repositoryId('pbakaus/impeccable')
const REPO_URL = 'https://github.com/pbakaus/impeccable.git' as HttpUrl
const REPO_HREF = 'https://github.com/pbakaus/impeccable'

/**
 * Minimal store with only the `ui` slice — SourceLink's only Redux touchpoint
 * is `setSelectedSources`. Keeping the surface tight isolates the test from
 * unrelated reducer churn.
 */
async function createStore() {
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  return configureStore({
    reducer: {
      ui: uiReducer,
    },
  })
}

interface RenderOptions {
  source?: RepositoryId
  sourceUrl?: HttpUrl
  /**
   * If provided, SourceLink is mounted inside a `<div>` with this onClick
   * handler so we can assert that propagation is correctly stopped (i.e. the
   * surrounding `<Card>`'s click does NOT fire when the user clicks the
   * filter button or the external-link anchor).
   */
  onParentClick?: (event: React.MouseEvent<HTMLDivElement>) => void
}

async function renderSourceLink(options: RenderOptions = {}) {
  const store = await createStore()
  const { SourceLink } = await import('./SourceLink')
  const screen = await render(
    <Provider store={store}>
      <div data-testid="parent-row" onClick={options.onParentClick}>
        <SourceLink source={options.source} sourceUrl={options.sourceUrl} />
      </div>
    </Provider>,
  )
  return { screen, store }
}

describe('SourceLink role split', () => {
  it('clicking the repo text replaces the source filter with that repo', async () => {
    // Arrange
    const { screen, store } = await renderSourceLink({
      source: REPO,
      sourceUrl: REPO_URL,
    })

    // Act
    await screen
      .getByRole('button', {
        name: /Filter skills by repository pbakaus\/impeccable/i,
      })
      .click()

    // Assert
    await expect.poll(() => store.getState().ui.selectedSources).toEqual([REPO])
  })

  it('opens the repo on GitHub in a new tab via the .git-stripped URL', async () => {
    // Arrange
    const { screen } = await renderSourceLink({
      source: REPO,
      sourceUrl: REPO_URL,
    })

    // Act
    const anchor = screen.getByRole('link', {
      name: /Open pbakaus\/impeccable on GitHub/i,
    })

    // Assert
    await expect.element(anchor).toHaveAttribute('href', REPO_HREF)
    await expect.element(anchor).toHaveAttribute('target', '_blank')
    await expect.element(anchor).toHaveAttribute('rel', 'noreferrer')
  })

  it('keeps the surrounding row from being selected when either affordance is clicked', async () => {
    // Arrange
    const onParentClick = vi.fn()
    const { screen, store } = await renderSourceLink({
      source: REPO,
      sourceUrl: REPO_URL,
      onParentClick,
    })

    // Act
    // Button click via Playwright driver — exercises the real React handler.
    await screen
      .getByRole('button', { name: /Filter skills by repository/i })
      .click()

    // Assert
    expect(onParentClick).not.toHaveBeenCalled()
    await expect.poll(() => store.getState().ui.selectedSources).toEqual([REPO])

    // Act
    // Anchor click via dispatchEvent — Playwright's `.click()` on a
    // `target="_blank"` anchor would try to open a new browser context.
    // A synthetic MouseEvent reaches the React handler the same way for
    // the propagation assertion without triggering the navigation gesture.
    const anchorElement = screen
      .getByRole('link', { name: /Open pbakaus\/impeccable on GitHub/i })
      .element() as HTMLAnchorElement
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    })
    anchorElement.dispatchEvent(clickEvent)

    // Assert
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('shows a plain "Local" label with no filter button or external link for a local skill', async () => {
    // Arrange
    const { screen } = await renderSourceLink()

    // Act
    // (no interaction — assert the rendered affordances for a local skill)

    // Assert
    await expect.element(screen.getByText('Local')).toBeInTheDocument()
    // Use `.query()` (returns null when missing) instead of `getBy(...).not.
    // toBeInTheDocument()` to avoid the strict-single-match throw — see
    // SkillItem.browser.test.tsx for the same pattern.
    expect(screen.getByRole('button').query()).toBeNull()
    expect(screen.getByRole('link').query()).toBeNull()
  })

  it('lets keyboard users focus the filter button and the external link independently', async () => {
    // Arrange
    const { screen } = await renderSourceLink({
      source: REPO,
      sourceUrl: REPO_URL,
    })
    const filterButton = screen.getByRole('button', {
      name: /Filter skills by repository/i,
    })
    const externalAnchor = screen.getByRole('link', {
      name: /Open pbakaus\/impeccable on GitHub/i,
    })

    // Act
    // Both elements are inherently focusable — `<button>` and `<a href>` —
    // so a regression that swaps either for a `<span>` (or adds tabindex=-1)
    // would surface here.
    const buttonElement = filterButton.element() as HTMLButtonElement
    buttonElement.focus()

    // Assert
    expect(document.activeElement).toBe(buttonElement)

    // Act
    const anchorElement = externalAnchor.element() as HTMLAnchorElement
    anchorElement.focus()

    // Assert
    expect(document.activeElement).toBe(anchorElement)
  })
})
