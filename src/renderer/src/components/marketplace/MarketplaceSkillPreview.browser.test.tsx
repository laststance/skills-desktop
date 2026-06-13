import { configureStore } from '@reduxjs/toolkit'
import type { ReactElement } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { SkillName, SkillSearchResult } from '@/shared/types'
import { repositoryId } from '@/shared/types'

/**
 * Build a minimal `SkillSearchResult` fixture and let callers override only the
 * field under test.
 * @param overrides - Partial overrides for the fixture.
 * @returns A valid `SkillSearchResult`.
 * @example
 * makeSkill({ url: 'https://evil.com/x' })
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
 * Create the smallest real Redux store shape the marketplace right-pane needs.
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
 * Render a component with the Redux provider for browser-mode tests.
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
 * Build a webview navigation event carrying the `url` field Electron's
 * `did-navigate` / `new-window` events expose, so the preview's handlers see a
 * realistic payload.
 * @param type - DOM event name (e.g. `'did-navigate'`).
 * @param url - Navigation target URL the handler reads from `e.url`.
 * @returns Cancelable event whose `url` is readable and `defaultPrevented` observable.
 * @example
 * webview.dispatchEvent(createWebviewEvent('did-navigate', 'https://skills.sh/x'))
 */
function createWebviewEvent(
  type: string,
  url: string,
): Event & { url: string } {
  const event = new Event(type, { cancelable: true }) as Event & {
    url: string
  }
  Object.defineProperty(event, 'url', {
    value: url,
    enumerable: true,
    configurable: true,
  })
  return event
}

const mockWriteText = vi.fn<(text: string) => Promise<void>>()
let originalClipboardDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  mockWriteText.mockReset()
  mockWriteText.mockResolvedValue(undefined)
  // Swap navigator.clipboard for a spy so the copy button resolves in-lane
  // without prompting for real clipboard permission (restored in afterEach).
  originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    'clipboard',
  )
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWriteText },
  })
})

afterEach(() => {
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
  vi.restoreAllMocks()
})

describe('MarketplaceSkillPreview', () => {
  it('returns to the dashboard by clearing the previewed skill when Back is clicked', async () => {
    // Arrange
    const store = await createStore()
    const { setPreviewSkill } =
      await import('@/renderer/src/redux/slices/marketplaceSlice')
    const { MarketplaceSkillPreview } =
      await import('./MarketplaceSkillPreview')
    const skill = makeSkill({ name: 'lint' as SkillName })
    store.dispatch(setPreviewSkill(skill))
    const screen = await renderWithStore(
      <MarketplaceSkillPreview skill={skill} />,
      store,
    )

    // Act
    await screen.getByRole('button', { name: 'Back to Dashboard' }).click()

    // Assert — the right pane drops back to the dashboard (no skill in preview)
    expect(store.getState().marketplace.previewSkill).toBeNull()
  })

  it('updates the footer URL when the webview navigates within the skills.sh allowlist', async () => {
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
    // Let useEffect attach the webview listeners before dispatching events.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const webview = document.querySelector('webview')
    expect(webview).not.toBeNull()
    if (!webview) {
      return
    }

    // Act — navigate in-allowlist to a different skills.sh page
    webview.dispatchEvent(
      createWebviewEvent('did-navigate', 'https://skills.sh/trending'),
    )

    // Assert — the footer mirrors the live URL the user now sees
    await expect
      .element(screen.getByTitle('https://skills.sh/trending'))
      .toHaveTextContent('https://skills.sh/trending')
  })

  it('keeps the footer URL unchanged when the webview navigates outside the allowlist', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 0))
    const webview = document.querySelector('webview')
    expect(webview).not.toBeNull()
    if (!webview) {
      return
    }

    // Act — a foreign-origin navigation slips through to did-navigate
    webview.dispatchEvent(
      createWebviewEvent('did-navigate', 'https://evil.com/path'),
    )

    // Assert — the footer still shows the original allowlisted URL
    await expect
      .element(screen.getByTitle('https://skills.sh/task'))
      .toHaveTextContent('https://skills.sh/task')
  })

  it('blocks window.open / target=_blank links from escaping the preview', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 0))
    const webview = document.querySelector('webview')
    expect(webview).not.toBeNull()
    if (!webview) {
      return
    }

    // Act — a new-window request fires from inside the guest page
    const newWindowEvent = createWebviewEvent(
      'new-window',
      'https://skills.sh/popup',
    )
    webview.dispatchEvent(newWindowEvent)

    // Assert — the popup is suppressed
    expect(newWindowEvent.defaultPrevented).toBe(true)
  })

  it('blocks in-page navigation to a non-allowlisted origin', async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 0))
    const webview = document.querySelector('webview')
    expect(webview).not.toBeNull()
    if (!webview) {
      return
    }

    // Act — the guest page tries to navigate to a foreign origin
    const blockedEvent = createWebviewEvent(
      'will-navigate',
      'https://evil.com/path',
    )
    webview.dispatchEvent(blockedEvent)

    // Assert — the navigation is cancelled
    expect(blockedEvent.defaultPrevented).toBe(true)
  })

  it('copies the live preview URL to the clipboard when the copy button is clicked', async () => {
    // Arrange
    const store = await createStore()
    const { MarketplaceSkillPreview } =
      await import('./MarketplaceSkillPreview')
    const screen = await renderWithStore(
      <MarketplaceSkillPreview skill={makeSkill()} />,
      store,
    )

    // Act
    await screen.getByRole('button', { name: 'Copy preview URL' }).click()

    // Assert — the current footer URL is written to the clipboard
    await vi.waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledWith('https://skills.sh/task')
    })
  })

  it('hides the loading skeleton once the webview finishes loading the page', async () => {
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
    // Let useEffect attach the webview listeners before dispatching events.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const webview = document.querySelector<HTMLElement>('webview')
    expect(webview).not.toBeNull()
    if (!webview) {
      return
    }

    // Act — the guest page reports a successful load
    webview.dispatchEvent(new Event('did-finish-load'))

    // Assert — the page becomes visible (skeleton gone, webview faded in)
    await expect.element(webview).toHaveClass('opacity-100')
  })

  it('hides the loading skeleton when the webview fails to load the page', async () => {
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
    // Let useEffect attach the webview listeners before dispatching events.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const webview = document.querySelector<HTMLElement>('webview')
    expect(webview).not.toBeNull()
    if (!webview) {
      return
    }

    // Act — the guest page reports a failed load
    webview.dispatchEvent(new Event('did-fail-load'))

    // Assert — the skeleton is dismissed so the user is not stuck on a spinner
    await expect.element(webview).toHaveClass('opacity-100')
  })

  it('shows a back-to-dashboard escape hatch instead of a webview for external URLs', async () => {
    // Arrange
    const store = await createStore()
    const { setPreviewSkill } =
      await import('@/renderer/src/redux/slices/marketplaceSlice')
    const { MarketplaceSkillPreview } =
      await import('./MarketplaceSkillPreview')
    const externalSkill = makeSkill({ url: 'https://example.com/skill' })
    store.dispatch(setPreviewSkill(externalSkill))
    const screen = await renderWithStore(
      <MarketplaceSkillPreview skill={externalSkill} />,
      store,
    )

    // Assert — the unsupported-URL message replaces the webview
    await expect
      .element(screen.getByText('Preview unavailable for external URLs'))
      .toBeInTheDocument()
    expect(document.querySelector('webview')).toBeNull()

    // Act — the fallback Back link also clears the preview
    await screen.getByRole('button', { name: 'Back to Dashboard' }).click()

    // Assert
    expect(store.getState().marketplace.previewSkill).toBeNull()
  })
})
