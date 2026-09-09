import { ACTION_HYDRATE_COMPLETE } from '@laststance/redux-storage-middleware'
import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Integration tests for the theme DOM side effect in listener.ts. The listener
 * is the ONLY writer of `--theme-hue` / `--theme-chroma` and `.dark` / `.light`
 * on `<html>` — if it silently breaks, every themed surface in the app stops
 * reacting to Redux state. Tests run in happy-dom so we can assert against a
 * real `document.documentElement`.
 *
 * Matcher coverage: setTheme, setModePreference, syncTheme,
 * ACTION_HYDRATE_COMPLETE. If a future reducer is added that mutates theme
 * state, extending the matcher in listener.ts requires a new test here.
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
  const { installThemeSubscriptions, listenerMiddleware } =
    await import('./listener')
  const { default: themeReducer } = await import('./slices/themeSlice')
  const store = configureStore({
    reducer: { theme: themeReducer },
    middleware: (getDefault) =>
      getDefault().prepend(listenerMiddleware.middleware),
  })
  // Mirrors store.ts: the window-level subscriptions are installed at store
  // creation, NOT from the hydration handler — the storage middleware skips
  // ACTION_HYDRATE_COMPLETE entirely when localStorage is still empty.
  installThemeSubscriptions(store)
  return store
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
  root.classList.remove('dark', 'light', 'tone-tinted')

  // Drop any preload bridge a cross-window test installed — happy-dom keeps
  // one `window` for the whole file, so a leftover stub would make the
  // "no bridge" test pass for the wrong reason.
  Reflect.deleteProperty(window, 'electron')
})

describe('theme listener — applyThemeToDOM', () => {
  test('paints a color preset onto <html> in dark mode when the user picks Cyan', async () => {
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

  test('drains color back to grayscale when the user switches to a neutral preset', async () => {
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

  test('applies the tone-tinted gray base only for tinted-neutral presets, not pure-neutral or color', async () => {
    // Arrange
    const store = await createThemedStore()
    const { setTheme } = await import('./slices/themeSlice')
    const root = document.documentElement

    // Act + Assert — a tinted-neutral preset (chroma 0.05) gets the soft base
    store.dispatch(setTheme('zinc-dark'))
    expect(root.classList.contains('tone-tinted')).toBe(true)

    // Act + Assert — switching to a full-color preset removes it (crisp ramp)
    store.dispatch(setTheme('cyan'))
    expect(root.classList.contains('tone-tinted')).toBe(false)

    // Act + Assert — a light tinted-neutral preset (zinc-light) also gets the soft base
    store.dispatch(setTheme('zinc-light'))
    expect(root.classList.contains('tone-tinted')).toBe(true)

    // Act + Assert — the pure-neutral default stays crisp (unchanged look)
    store.dispatch(setTheme('neutral-dark'))
    expect(root.classList.contains('tone-tinted')).toBe(false)
  })

  test('toggles the <html> dark/light classes when the user flips the mode preference', async () => {
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

  test('repaints the persisted theme onto <html> when hydration completes', async () => {
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

  test('clears selectedAgentId when setSettings hides the currently-selected agent', async () => {
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

  test('preserves selectedAgentId when setSettings hides a different agent', async () => {
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

  test('does not dispatch selectAgent(null) when no agent is selected and a hide lands', async () => {
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

  test('OS appearance change re-applies theme when modePreference is "system"', async () => {
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

  test('subscribes to OS appearance only once even if the installer runs twice', async () => {
    // Idempotency guard for the OS-appearance subscription: `store.ts` installs
    // once, but a hot-module-reload replay must NOT stack a second
    // `prefers-color-scheme` change listener. Without the
    // `systemThemeListenerInstalled` short-circuit, every replay would add
    // another subscription, so one OS flip would re-resolve the theme N times
    // and leak listeners. The guard makes the second install a no-op, which we
    // observe by counting matchMedia calls.

    // Arrange — a matchMedia spy installed before importing the listener so the
    // first hydrate wires its change handler against our stub.
    let osAppearanceSubscriptions = 0
    const matchMediaStub = vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return false
      },
      media: query,
      addEventListener: vi.fn((event: string) => {
        if (event === 'change') osAppearanceSubscriptions += 1
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: matchMediaStub,
    })

    const store = await createThemedStore()
    const { installThemeSubscriptions } = await import('./listener')

    // Act — install a second time on the SAME module instance, so the
    // module-level installed flag persists between the two calls.
    installThemeSubscriptions(store)

    // Assert — only the first install subscribed; the second hit the guard.
    expect(osAppearanceSubscriptions).toBe(1)
    expect(matchMediaStub).toHaveBeenCalledTimes(1)
  })

  test('OS appearance change is ignored when modePreference is sticky light/dark', async () => {
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

  test('skips installing the OS-appearance subscription in environments without matchMedia', async () => {
    // Regression guard for the headless-safety branch: when the renderer is
    // imported somewhere `window.matchMedia` is absent (e.g. an SSR/headless
    // probe or a stripped jsdom variant), hydration must still paint the theme
    // and must NOT throw trying to subscribe to a non-existent media query.
    // If the `typeof window.matchMedia !== 'function'` short-circuit ever
    // regresses, this dispatch crashes with a TypeError instead of no-opping.

    // Arrange — remove matchMedia so the listener's headless guard fires, but
    // remember the original so sibling tests keep their stubbable matchMedia.
    const originalMatchMedia = window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    })

    try {
      // Act (part 1) — creating the store runs the installer, which must
      // early-return on the missing matchMedia rather than calling it.
      const store = await createThemedStore()
      const { setTheme } = await import('./slices/themeSlice')
      store.dispatch(setTheme('blue'))
      const root = document.documentElement
      root.style.removeProperty('--theme-hue')
      root.style.removeProperty('--theme-chroma')
      root.classList.remove('dark', 'light')

      // Act (part 2) — hydration still repaints without throwing.
      expect(() =>
        store.dispatch({ type: ACTION_HYDRATE_COMPLETE }),
      ).not.toThrow()

      // Assert — the theme was still painted (hydrate's applyThemeToDOM ran),
      // and no media-query subscription was attempted.
      expect(root.style.getPropertyValue('--theme-hue')).toBe('250')
      expect(root.classList.contains('dark')).toBe(true)
    } finally {
      // Restore the env-provided matchMedia for the remaining tests.
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      })
    }
  })

  test('paints rapid preset switches onto <html> in dispatch order without stale reordering', async () => {
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

describe('theme listener — cross-window sync', () => {
  /**
   * Install a stub preload bridge and hand back the pieces the tests drive:
   * `broadcast` records what this window published, and `emitChanged` plays
   * the other window's broadcast back in.
   */
  function stubThemeBridge() {
    const broadcast = vi.fn().mockResolvedValue(undefined)
    let received: ((state: unknown) => void) | null = null
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        theme: {
          broadcast,
          onChanged: (callback: (state: unknown) => void) => {
            received = callback
            return () => {}
          },
        },
      },
    })
    return {
      broadcast,
      emitChanged: (state: unknown) => received?.(state),
    }
  }

  test('publishes the resolved theme so the Settings window can follow a mode switch', async () => {
    // Arrange
    const { broadcast } = stubThemeBridge()
    const store = await createThemedStore()
    const { setModePreference } = await import('./slices/themeSlice')

    // Act
    store.dispatch(setModePreference('light'))

    // Assert — the whole resolved state travels, not just the preset name:
    // the receiving window must not re-resolve `mode` against its own
    // matchMedia.
    expect(broadcast).toHaveBeenCalledWith({
      hue: 0,
      chroma: 0,
      mode: 'light',
      modePreference: 'light',
      preset: 'neutral-light',
    })
  })

  test('adopts a theme published by the other window without echoing it back', async () => {
    // Regression guard for an infinite cross-window bounce: if adopting a
    // broadcast re-published it, the two windows would relay the same state
    // to each other forever.

    // Arrange
    const { broadcast, emitChanged } = stubThemeBridge()
    const store = await createThemedStore()

    // Act — the other window switched to Cyan.
    emitChanged({
      hue: 195,
      chroma: 0.16,
      mode: 'dark',
      modePreference: 'dark',
      preset: 'cyan',
    })

    // Assert
    expect(store.getState().theme.preset).toBe('cyan')
    expect(broadcast).not.toHaveBeenCalled()
  })

  test('repaints <html> when the other window switches from Dark to Light', async () => {
    // The bug this whole path exists for: an open Settings window used to
    // stay Dark until it was closed and reopened.

    // Arrange
    const { emitChanged } = stubThemeBridge()
    const store = await createThemedStore()
    // A returning user: hydration repaints the persisted dark palette first.
    store.dispatch({ type: ACTION_HYDRATE_COMPLETE })
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    // Act
    emitChanged({
      hue: 0,
      chroma: 0,
      mode: 'light',
      modePreference: 'light',
      preset: 'neutral-light',
    })

    // Assert
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  test('subscribes to the other window only once even if the installer runs twice', async () => {
    // Arrange
    let subscriptions = 0
    Object.defineProperty(window, 'electron', {
      configurable: true,
      writable: true,
      value: {
        theme: {
          broadcast: vi.fn().mockResolvedValue(undefined),
          onChanged: () => {
            subscriptions += 1
            return () => {}
          },
        },
      },
    })
    const store = await createThemedStore()
    const { installThemeSubscriptions } = await import('./listener')

    // Act
    installThemeSubscriptions(store)

    // Assert
    expect(subscriptions).toBe(1)
  })

  test('still paints the theme when no preload bridge is present', async () => {
    // The node test lane and Storybook both render this store without
    // `window.electron`; theme must keep working rather than throw.

    // Arrange — `beforeEach` already removed any stub bridge.
    const store = await createThemedStore()
    const { setTheme } = await import('./slices/themeSlice')

    // Act
    store.dispatch(setTheme('neutral-light'))

    // Assert
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  test('still follows the other window on a first launch, before anything is persisted', async () => {
    // Regression guard for the trigger these subscriptions used to hang off:
    // the storage middleware short-circuits without dispatching
    // ACTION_HYDRATE_COMPLETE when localStorage holds nothing, so installing
    // on hydration left a fresh profile with no cross-window sync at all.

    // Arrange — a store that never sees a hydrate action.
    const { emitChanged } = stubThemeBridge()
    const store = await createThemedStore()

    // Act
    emitChanged({
      hue: 0,
      chroma: 0,
      mode: 'light',
      modePreference: 'light',
      preset: 'neutral-light',
    })

    // Assert
    expect(store.getState().theme.mode).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })
})
