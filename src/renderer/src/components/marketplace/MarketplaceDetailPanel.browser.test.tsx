import { configureStore } from '@reduxjs/toolkit'
import type { ReactElement } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { SkillName, SkillSearchResult } from '@/shared/types'
import { repositoryId } from '@/shared/types'

// MarketplaceDashboard (rendered by MarketplaceDetailPanel when nothing is
// previewed) dispatches `loadLeaderboard('trending')` on mount, whose thunk
// reads `window.electron.marketplace.leaderboard`. Browser-mode tests replace
// the preload bridge, so the IPC surface is stubbed. The default never-resolving
// promise lets each test pin the state it dispatched without a late `fulfilled`
// racing in; the error test overrides it with a rejection so the re-fetch
// (errors bypass the cache-TTL gate) settles back on the error branch.
const mockLeaderboard = vi.fn()

beforeEach(() => {
  mockLeaderboard.mockReset()
  mockLeaderboard.mockReturnValue(new Promise<SkillSearchResult[]>(() => {}))
  vi.stubGlobal('electron', {
    marketplace: {
      leaderboard: mockLeaderboard,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

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
    import('@/renderer/src/redux/slices/marketplaceSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/bookmarkSlice'),
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
  it('shows the Marketplace dashboard heading when nothing is selected for preview', async () => {
    // Arrange
    const store = await createStore()
    const { MarketplaceDetailPanel } = await import('./MarketplaceDetailPanel')

    // Act
    const screen = await renderWithStore(<MarketplaceDetailPanel />, store)

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'Marketplace' }))
      .toBeInTheDocument()
  })

  it('opens the skill preview with a Back to Dashboard escape hatch after a skill is chosen', async () => {
    // Arrange
    const store = await createStore()
    const { setPreviewSkill } =
      await import('@/renderer/src/redux/slices/marketplaceSlice')
    const { MarketplaceDetailPanel } = await import('./MarketplaceDetailPanel')
    store.dispatch(setPreviewSkill(makeSkill({ name: 'lint' as SkillName })))

    // Act
    const screen = await renderWithStore(<MarketplaceDetailPanel />, store)

    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Back to Dashboard' }))
      .toBeInTheDocument()
  })
})

describe('MarketplaceDashboard trending placeholders', () => {
  it('shows a loading skeleton, announced to screen readers, before trending skills have been fetched', async () => {
    // Arrange
    const store = await createStore()
    const { MarketplaceDashboard } = await import('./MarketplaceDashboard')

    // Act
    const screen = await renderWithStore(<MarketplaceDashboard />, store)

    // Assert — the pulsing placeholder carries an accessible loading status
    await expect
      .element(screen.getByRole('status', { name: 'Loading trending skills' }))
      .toBeInTheDocument()
  })

  it('shows an empty-state message when trending skills load but return nothing', async () => {
    // Arrange
    const store = await createStore()
    const { loadLeaderboard } =
      await import('@/renderer/src/redux/slices/marketplaceSlice')
    const { MarketplaceDashboard } = await import('./MarketplaceDashboard')
    store.dispatch(
      loadLeaderboard.fulfilled(
        { filter: 'trending', skills: [] },
        'test-request',
        'trending',
      ),
    )

    // Act
    const screen = await renderWithStore(<MarketplaceDashboard />, store)

    // Assert
    await expect
      .element(screen.getByText('No trending skills available'))
      .toBeInTheDocument()
  })

  it('shows an offline notice when the trending fetch fails with nothing cached', async () => {
    // Arrange — seed the failed state, then make the mount re-fetch fail too so
    // the panel settles back on the error branch (errors bypass the TTL gate,
    // so the dashboard re-requests trending on mount).
    mockLeaderboard.mockRejectedValue(new Error('network down'))
    const store = await createStore()
    const { loadLeaderboard } =
      await import('@/renderer/src/redux/slices/marketplaceSlice')
    const { MarketplaceDashboard } = await import('./MarketplaceDashboard')
    store.dispatch(
      loadLeaderboard.rejected(
        new Error('network down'),
        'test-request',
        'trending',
      ),
    )

    // Act
    const screen = await renderWithStore(<MarketplaceDashboard />, store)

    // Assert — a failed load surfaces a recoverable offline notice, not a blank list
    await expect
      .element(screen.getByText('Trending unavailable'))
      .toBeInTheDocument()
  })
})

describe('MarketplaceSkillPreview will-navigate allowlist', () => {
  it('blocks navigation to other origins and to skills.sh on a non-standard port while letting skills.sh through', async () => {
    // Arrange
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

    // Act — dispatch a foreign origin
    const blockedEvent = createWillNavigateEvent('https://evil.com/path')
    webview.dispatchEvent(blockedEvent)
    // Assert — the foreign origin is cancelled
    expect(blockedEvent.defaultPrevented).toBe(true)

    // Act — dispatch skills.sh on a custom port
    const blockedCustomPortEvent = createWillNavigateEvent(
      'https://skills.sh:444/trending',
    )
    webview.dispatchEvent(blockedCustomPortEvent)
    // Assert — the custom-port URL is still cancelled
    expect(blockedCustomPortEvent.defaultPrevented).toBe(true)

    // Act — dispatch canonical skills.sh
    const allowedEvent = createWillNavigateEvent('https://skills.sh/trending')
    webview.dispatchEvent(allowedEvent)
    // Assert — canonical skills.sh is allowed through
    expect(allowedEvent.defaultPrevented).toBe(false)
  })
})
