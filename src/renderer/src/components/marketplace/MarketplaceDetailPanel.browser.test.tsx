import { configureStore } from '@reduxjs/toolkit'
import type { ReactElement } from 'react'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import type { SkillName, SkillSearchResult } from '../../../../shared/types'
import { repositoryId } from '../../../../shared/types'

/**
 * Build a minimal `SkillSearchResult` fixture and let callers override only
 * the field under test.
 * @param overrides - Partial overrides for the fixture.
 * @returns A valid `SkillSearchResult`.
 * @example
 * makeSkill({ name: 'lint' as SkillName })
 */
function makeSkill(
  overrides: Partial<SkillSearchResult> = {},
): SkillSearchResult {
  return {
    rank: 1,
    name: 'task' as SkillName,
    repo: repositoryId('vercel-labs/skills'),
    url: 'https://skills.sh/task',
    installCount: 123,
    ...overrides,
  }
}

/**
 * Create the smallest real Redux store shape needed by marketplace right-pane
 * components.
 * @returns Store wired with marketplace, skills, and bookmarks reducers.
 */
async function createStore() {
  const [
    { default: marketplaceReducer },
    { default: skillsReducer },
    { default: bookmarkReducer },
  ] = await Promise.all([
    import('../../redux/slices/marketplaceSlice'),
    import('../../redux/slices/skillsSlice'),
    import('../../redux/slices/bookmarkSlice'),
  ])

  return configureStore({
    reducer: {
      marketplace: marketplaceReducer,
      skills: skillsReducer,
      bookmarks: bookmarkReducer,
    },
  })
}

/**
 * Render a component with Redux provider for browser-mode tests.
 * @param ui - Target component tree.
 * @param store - Test store instance.
 * @returns Render handle from `vitest-browser-react`.
 */
async function renderWithStore(
  ui: ReactElement,
  store: Awaited<ReturnType<typeof createStore>>,
) {
  return render(<Provider store={store}>{ui}</Provider>)
}

/**
 * Create a cancelable `will-navigate` event carrying the URL field expected by
 * Electron's `WillNavigateEvent`.
 * @param url - Navigation target URL.
 * @returns Event object whose `defaultPrevented` reflects guard behavior.
 * @example
 * const event = createWillNavigateEvent('https://evil.com')
 * webview.dispatchEvent(event)
 * event.defaultPrevented // => true
 */
function createWillNavigateEvent(url: string): Event & { url: string } {
  const event = new Event('will-navigate', { cancelable: true }) as Event & {
    url: string
  }
  Object.defineProperty(event, 'url', {
    value: url,
    enumerable: true,
    configurable: true,
  })
  return event
}

describe('MarketplaceDetailPanel routing', () => {
  it('renders dashboard when no preview skill is selected', async () => {
    const store = await createStore()
    const { MarketplaceDetailPanel } = await import('./MarketplaceDetailPanel')
    const screen = await renderWithStore(<MarketplaceDetailPanel />, store)

    await expect
      .element(screen.getByRole('heading', { name: 'Marketplace' }))
      .toBeInTheDocument()
  })

  it('renders preview pane when previewSkill is set', async () => {
    const store = await createStore()
    const { setPreviewSkill } =
      await import('../../redux/slices/marketplaceSlice')
    const { MarketplaceDetailPanel } = await import('./MarketplaceDetailPanel')
    store.dispatch(setPreviewSkill(makeSkill({ name: 'lint' as SkillName })))

    const screen = await renderWithStore(<MarketplaceDetailPanel />, store)
    await expect
      .element(screen.getByRole('button', { name: 'Back to Dashboard' }))
      .toBeInTheDocument()
  })
})

describe('MarketplaceDashboard empty state', () => {
  it('shows loading copy while trending leaderboard data is not loaded yet', async () => {
    const store = await createStore()
    const { MarketplaceDashboard } = await import('./MarketplaceDashboard')

    const screen = await renderWithStore(<MarketplaceDashboard />, store)
    await expect
      .element(screen.getByText('Loading trending skills...'))
      .toBeInTheDocument()
  })

  it('shows empty-result copy when trending leaderboard is fulfilled with no skills', async () => {
    const store = await createStore()
    const { loadLeaderboard } =
      await import('../../redux/slices/marketplaceSlice')
    const { MarketplaceDashboard } = await import('./MarketplaceDashboard')
    store.dispatch(
      loadLeaderboard.fulfilled(
        { filter: 'trending', skills: [] },
        'test-request',
        'trending',
      ),
    )

    const screen = await renderWithStore(<MarketplaceDashboard />, store)
    await expect
      .element(screen.getByText('No trending skills available'))
      .toBeInTheDocument()
  })
})

describe('MarketplaceSkillPreview will-navigate allowlist', () => {
  it('prevents cross-origin navigation and allows skills.sh navigation', async () => {
    const store = await createStore()
    const { MarketplaceSkillPreview } =
      await import('./MarketplaceSkillPreview')
    const screen = await renderWithStore(
      <MarketplaceSkillPreview skill={makeSkill()} />,
      store,
    )

    await expect
      .element(screen.getByRole('button', { name: 'Back to Dashboard' }))
      .toBeInTheDocument()

    // Let useEffect attach webview listeners before dispatching test events.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const webview = document.querySelector('webview')
    expect(webview).not.toBeNull()
    if (!webview) {
      return
    }

    const blockedEvent = createWillNavigateEvent('https://evil.com/path')
    webview.dispatchEvent(blockedEvent)
    expect(blockedEvent.defaultPrevented).toBe(true)

    const blockedCustomPortEvent = createWillNavigateEvent(
      'https://skills.sh:444/trending',
    )
    webview.dispatchEvent(blockedCustomPortEvent)
    expect(blockedCustomPortEvent.defaultPrevented).toBe(true)

    const allowedEvent = createWillNavigateEvent('https://skills.sh/trending')
    webview.dispatchEvent(allowedEvent)
    expect(allowedEvent.defaultPrevented).toBe(false)
  })
})
