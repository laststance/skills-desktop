import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import {
  type HttpUrl,
  type RepositoryId,
  repositoryId,
} from '../../../../shared/types'

const REPO = repositoryId('pbakaus/impeccable')
const REPO_URL = 'https://github.com/pbakaus/impeccable.git' as HttpUrl
const REPO_HREF = 'https://github.com/pbakaus/impeccable'

/**
 * Minimal store with only the `ui` slice — SourceLink's only Redux touchpoint
 * is `setSelectedSource`. Keeping the surface tight isolates the test from
 * unrelated reducer churn.
 */
async function createStore() {
  const { default: uiReducer } = await import('../../redux/slices/uiSlice')
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
  it('clicking the repo text dispatches setSelectedSource', async () => {
    const { screen, store } = await renderSourceLink({
      source: REPO,
      sourceUrl: REPO_URL,
    })

    await screen
      .getByRole('button', {
        name: /Filter skills by repository pbakaus\/impeccable/i,
      })
      .click()

    await expect.poll(() => store.getState().ui.selectedSource).toBe(REPO)
  })

  it('the icon anchor points at the .git-stripped GitHub URL with target=_blank', async () => {
    const { screen } = await renderSourceLink({
      source: REPO,
      sourceUrl: REPO_URL,
    })

    const anchor = screen.getByRole('link', {
      name: /Open pbakaus\/impeccable on GitHub/i,
    })
    await expect.element(anchor).toHaveAttribute('href', REPO_HREF)
    await expect.element(anchor).toHaveAttribute('target', '_blank')
    await expect.element(anchor).toHaveAttribute('rel', 'noreferrer')
  })

  it('clicks on either affordance do not bubble to the surrounding row', async () => {
    const onParentClick = vi.fn()
    const { screen, store } = await renderSourceLink({
      source: REPO,
      sourceUrl: REPO_URL,
      onParentClick,
    })

    // Button click via Playwright driver — exercises the real React handler.
    await screen
      .getByRole('button', { name: /Filter skills by repository/i })
      .click()
    expect(onParentClick).not.toHaveBeenCalled()
    await expect.poll(() => store.getState().ui.selectedSource).toBe(REPO)

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
    expect(onParentClick).not.toHaveBeenCalled()
  })

  it('Local skill renders the "Local" label with no button or anchor', async () => {
    const { screen } = await renderSourceLink()

    await expect.element(screen.getByText('Local')).toBeInTheDocument()
    // Use `.query()` (returns null when missing) instead of `getBy(...).not.
    // toBeInTheDocument()` to avoid the strict-single-match throw — see
    // SkillItem.browser.test.tsx for the same pattern.
    expect(screen.getByRole('button').query()).toBeNull()
    expect(screen.getByRole('link').query()).toBeNull()
  })

  it('keyboard Tab focuses the filter button and the external link independently', async () => {
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

    // Both elements are inherently focusable — `<button>` and `<a href>` —
    // so a regression that swaps either for a `<span>` (or adds tabindex=-1)
    // would surface here.
    const buttonElement = filterButton.element() as HTMLButtonElement
    buttonElement.focus()
    expect(document.activeElement).toBe(buttonElement)

    const anchorElement = externalAnchor.element() as HTMLAnchorElement
    anchorElement.focus()
    expect(document.activeElement).toBe(anchorElement)
  })
})
