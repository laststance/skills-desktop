import { ACTION_HYDRATE_COMPLETE } from '@laststance/redux-storage-middleware'
import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Integration tests for the theme DOM side effect in listener.ts. The listener
 * is the ONLY writer of `--theme-hue` / `--theme-chroma` and `.dark` / `.light`
 * on `<html>` — if it silently breaks, every themed surface in the app stops
 * reacting to Redux state. Tests run in happy-dom so we can assert against a
 * real `document.documentElement`.
 *
 * Matcher coverage: setTheme, setModePreference, ACTION_HYDRATE_COMPLETE. If
 * a future reducer is added that mutates theme state, extending the matcher
 * in listener.ts requires a new test here.
 *
 * @vitest-environment happy-dom
 */

/**
 * Build a themed store with a freshly-evaluated listener middleware. Callers
 * must run `vi.resetModules()` in `beforeEach` so the top-level
 * `startListening(...)` calls in `listener.ts` re-execute on a new middleware
 * instance — otherwise the first test registers the listeners, later tests
 * re-import the same cached module, and the DOM side effect silently becomes
 * a no-op.
 */
async function createThemedStore() {
  const { listenerMiddleware } = await import('./listener')
  const { default: themeReducer } = await import('./slices/themeSlice')
  return configureStore({
    reducer: { theme: themeReducer },
    middleware: (getDefault) =>
      getDefault().prepend(listenerMiddleware.middleware),
  })
}

beforeEach(() => {
  // Force `./listener` (and its transitive `./slices/themeSlice` import) to
  // re-evaluate on the next dynamic import so listener registrations are
  // fresh per test. Without this, startListening calls happen exactly once
  // and any clearListeners() between tests leaves the middleware inert.
  vi.resetModules()

  // Reset <html> between tests so we see only the effects of the action under
  // test, not stale state from a previous run.
  const root = document.documentElement
  root.style.removeProperty('--theme-hue')
  root.style.removeProperty('--theme-chroma')
  root.classList.remove('dark', 'light')
})

describe('theme listener — applyThemeToDOM', () => {
  it('paints a color preset onto <html> in dark mode when the user picks Cyan', async () => {
    // Arrange
    const store = await createThemedStore()
    const { setTheme } = await import('./slices/themeSlice')

    // Act
    store.dispatch(setTheme('cyan'))

    // Assert
    const root = document.documentElement
    expect(root.style.getPropertyValue('--theme-hue')).toBe('195')
    // chroma value depends on COLOR_PRESET_CHROMA; just assert it's non-zero.
    expect(
      Number(root.style.getPropertyValue('--theme-chroma')),
    ).toBeGreaterThan(0)
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('light')).toBe(false)
  })

  it('drains color back to grayscale when the user switches to a neutral preset', async () => {
    // Arrange — start on a colored preset so chroma is non-zero
    const store = await createThemedStore()
    const { setTheme } = await import('./slices/themeSlice')
    store.dispatch(setTheme('rose'))
    expect(
      Number(document.documentElement.style.getPropertyValue('--theme-chroma')),
    ).toBeGreaterThan(0)

    // Act
    store.dispatch(setTheme('neutral-dark'))

    // Assert
    expect(
      document.documentElement.style.getPropertyValue('--theme-chroma'),
    ).toBe('0')
  })

  it('toggles the <html> dark/light classes when the user flips the mode preference', async () => {
    // Arrange — start with a color preset so we can flip mode independently
    const store = await createThemedStore()
    const { setTheme, setModePreference } = await import('./slices/themeSlice')
    store.dispatch(setTheme('violet'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    // Act — flip to light
    store.dispatch(setModePreference('light'))

    // Assert
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.classList.contains('light')).toBe(true)

    // Act — flip back to dark
    store.dispatch(setModePreference('dark'))

    // Assert
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('repaints the persisted theme onto <html> when hydration completes', async () => {
    // Arrange — simulate storage-middleware finishing hydration with a saved
    // color preset. The listener reads `state.theme` at that instant and
    // projects it onto <html>. Without this path, first paint post-hydration
    // is blank. Reset the DOM first so we only observe the hydrate effect.
    const store = await createThemedStore()
    const { setTheme } = await import('./slices/themeSlice')
    store.dispatch(setTheme('blue'))
    const root = document.documentElement
    root.style.removeProperty('--theme-hue')
    root.style.removeProperty('--theme-chroma')
    root.classList.remove('dark', 'light')

    // Act
    store.dispatch({ type: ACTION_HYDRATE_COMPLETE })

    // Assert
    expect(root.style.getPropertyValue('--theme-hue')).toBe('250')
    expect(
      Number(root.style.getPropertyValue('--theme-chroma')),
    ).toBeGreaterThan(0)
    expect(root.classList.contains('dark')).toBe(true)
  })

  it('clears selectedAgentId when setSettings hides the currently-selected agent', async () => {
    // Cross-slice invariant: hiding an agent from the sidebar must not
    // leave the central skill list filtering by an agent the user can no
    // longer see. The listener middleware enforces this regardless of
    // whether AgentsSection is mounted (Settings can hide an agent during
    // a navigation transition in the main window). Without this listener,
    // selecting an agent in the sidebar then hiding it from Settings would
    // leave selectedAgentId pinned to the now-invisible agent.
    const { listenerMiddleware } = await import('./listener')
    const { default: settingsReducer, setSettings } =
      await import('./slices/settingsSlice')
    const { default: uiReducer, selectAgent } = await import('./slices/uiSlice')
    const { DEFAULT_SETTINGS } = await import('@/shared/settings')

    const store = configureStore({
      reducer: { settings: settingsReducer, ui: uiReducer },
      middleware: (getDefault) =>
        getDefault().prepend(listenerMiddleware.middleware),
    })

    // Arrange — select the agent that is about to be hidden
    store.dispatch(selectAgent('claude-code'))
    expect(store.getState().ui.selectedAgentId).toBe('claude-code')

    // Act — hide the currently-selected agent via Settings
    store.dispatch(
      setSettings({ ...DEFAULT_SETTINGS, hiddenAgentIds: ['claude-code'] }),
    )

    // Assert
    expect(store.getState().ui.selectedAgentId).toBeNull()
  })

  it('preserves selectedAgentId when setSettings hides a different agent', async () => {
    // Inverse case for the invariant above: if the hidden agent isn't
    // the one currently selected, the listener must not clobber the
    // selection. Pinning this guards against an over-eager `selectAgent(null)`
    // dispatch that would lose the user's filter on every settings write.
    const { listenerMiddleware } = await import('./listener')
    const { default: settingsReducer, setSettings } =
      await import('./slices/settingsSlice')
    const { default: uiReducer, selectAgent } = await import('./slices/uiSlice')
    const { DEFAULT_SETTINGS } = await import('@/shared/settings')

    const store = configureStore({
      reducer: { settings: settingsReducer, ui: uiReducer },
      middleware: (getDefault) =>
        getDefault().prepend(listenerMiddleware.middleware),
    })

    // Arrange — select cursor, the agent that will NOT be hidden
    store.dispatch(selectAgent('cursor'))

    // Act — hide a different agent (claude-code)
    store.dispatch(
      setSettings({ ...DEFAULT_SETTINGS, hiddenAgentIds: ['claude-code'] }),
    )

    // Assert
    expect(store.getState().ui.selectedAgentId).toBe('cursor')
  })

  it('does not dispatch selectAgent(null) when no agent is selected and a hide lands', async () => {
    // The third arm of the listener guard: selectedAgentId is already
    // null. Without the `selectedAgentId !== null` short-circuit the
    // listener would dispatch a redundant `selectAgent(null)` on every
    // settings write — wasted middleware churn and a phantom transition
    // for any selector that watches `ui.selectedAgentId` for changes.
    const { listenerMiddleware } = await import('./listener')
    const { default: settingsReducer, setSettings } =
      await import('./slices/settingsSlice')
    const { default: uiReducer } = await import('./slices/uiSlice')
    const { DEFAULT_SETTINGS } = await import('@/shared/settings')

    const store = configureStore({
      reducer: { settings: settingsReducer, ui: uiReducer },
      middleware: (getDefault) =>
        getDefault().prepend(listenerMiddleware.middleware),
    })

    // Arrange — capture the ui slice reference before the settings update; if
    // the listener's no-op short-circuit holds, the reducer is never re-run
    // and the ui slice keeps the same reference.
    const uiBefore = store.getState().ui

    // Act — a hide lands while no agent is selected
    store.dispatch(
      setSettings({ ...DEFAULT_SETTINGS, hiddenAgentIds: ['claude-code'] }),
    )

    // Assert — ui slice untouched (same reference) and selection still null
    expect(store.getState().ui).toBe(uiBefore)
    expect(store.getState().ui.selectedAgentId).toBeNull()
  })

  it('OS appearance change re-applies theme when modePreference is "system"', async () => {
    // Arrange — stub matchMedia BEFORE importing listener so the hydrate
    // handler installs the change listener against our spy.
    let capturedChangeHandler: ((event: MediaQueryListEvent) => void) | null =
      null
    let osPrefersDark = true
    const matchMediaStub = vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return query === '(prefers-color-scheme: dark)' ? osPrefersDark : false
      },
      media: query,
      addEventListener: vi.fn(
        (event: string, handler: (e: MediaQueryListEvent) => void) => {
          if (event === 'change') capturedChangeHandler = handler
        },
      ),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: matchMediaStub,
    })

    const store = await createThemedStore()
    const { setModePreference } = await import('./slices/themeSlice')

    // Act — install the OS-change handler, then opt into Auto with the OS
    // currently reporting Dark.
    store.dispatch({ type: ACTION_HYDRATE_COMPLETE })
    store.dispatch(setModePreference('system'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    // Simulate the user flipping macOS Appearance to Light while the app is
    // running. The OS fires a `change` event on the media query; the
    // listener must re-resolve and project the new mode onto <html>.
    osPrefersDark = false
    expect(capturedChangeHandler).not.toBeNull()
    capturedChangeHandler!({
      matches: false,
      media: '(prefers-color-scheme: dark)',
    } as MediaQueryListEvent)

    // Assert — DOM followed the OS without the user touching the dropdown.
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(store.getState().theme.mode).toBe('light')
    expect(store.getState().theme.modePreference).toBe('system')
  })

  it('OS appearance change is ignored when modePreference is sticky light/dark', async () => {
    // Arrange — same wiring as the Auto test, but user pinned Light.
    let capturedChangeHandler: ((event: MediaQueryListEvent) => void) | null =
      null
    let osPrefersDark = false
    const matchMediaStub = vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return query === '(prefers-color-scheme: dark)' ? osPrefersDark : false
      },
      media: query,
      addEventListener: vi.fn(
        (event: string, handler: (e: MediaQueryListEvent) => void) => {
          if (event === 'change') capturedChangeHandler = handler
        },
      ),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: matchMediaStub,
    })

    const store = await createThemedStore()
    const { setModePreference } = await import('./slices/themeSlice')

    // Act — install the OS-change handler, then explicitly pin Light.
    store.dispatch({ type: ACTION_HYDRATE_COMPLETE })
    store.dispatch(setModePreference('light'))
    expect(document.documentElement.classList.contains('light')).toBe(true)

    // Simulate the OS flipping to Dark — the handler should observe that
    // modePreference !== 'system' and bail without dispatching anything.
    osPrefersDark = true
    capturedChangeHandler!({
      matches: true,
      media: '(prefers-color-scheme: dark)',
    } as MediaQueryListEvent)

    // Assert — app stays Light because the user pinned it.
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(store.getState().theme.mode).toBe('light')
    expect(store.getState().theme.modePreference).toBe('light')
  })

  it('paints rapid preset switches onto <html> in dispatch order without stale reordering', async () => {
    // Arrange — regression guard for the "stale listener write" class of bug:
    // if the listener ever queues async writes (via Promise.resolve, microtask,
    // requestAnimationFrame, etc.), the order of setProperty calls could
    // diverge from dispatch order and the final DOM could reflect an earlier
    // preset. Asserting only on final state would miss that: we also spy on
    // setProperty and pin the `--theme-hue` call sequence to the dispatched
    // sequence, which is what actually catches reordering.
    const store = await createThemedStore()
    const { setTheme } = await import('./slices/themeSlice')
    const setPropertySpy = vi.spyOn(
      document.documentElement.style,
      'setProperty',
    )

    // Act
    store.dispatch(setTheme('rose'))
    store.dispatch(setTheme('cyan'))
    store.dispatch(setTheme('violet'))
    store.dispatch(setTheme('neutral-light'))

    // Assert — extract --theme-hue writes in the order they happened; the
    // expected sequence mirrors the four dispatches above (350 → 195 → 300 → 0).
    const hueWrites = setPropertySpy.mock.calls
      .filter(([prop]) => prop === '--theme-hue')
      .map(([, value]) => value)
    expect(hueWrites).toEqual(['350', '195', '300', '0'])

    const root = document.documentElement
    expect(root.style.getPropertyValue('--theme-hue')).toBe('0')
    expect(root.style.getPropertyValue('--theme-chroma')).toBe('0')
    expect(root.classList.contains('light')).toBe(true)
    expect(root.classList.contains('dark')).toBe(false)
    expect(store.getState().theme.preset).toBe('neutral-light')

    setPropertySpy.mockRestore()
  })
})
