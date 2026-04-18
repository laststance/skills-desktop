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
 * Matcher coverage: setTheme, toggleMode, ACTION_HYDRATE_COMPLETE. If a future
 * reducer is added that mutates theme state, extending the matcher in
 * listener.ts requires a new test here.
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
  it('writes --theme-hue, --theme-chroma, and .dark on setTheme(cyan)', async () => {
    const store = await createThemedStore()
    const { setTheme } = await import('./slices/themeSlice')

    store.dispatch(setTheme('cyan'))

    const root = document.documentElement
    expect(root.style.getPropertyValue('--theme-hue')).toBe('195')
    // chroma value depends on COLOR_PRESET_CHROMA; just assert it's non-zero.
    expect(
      Number(root.style.getPropertyValue('--theme-chroma')),
    ).toBeGreaterThan(0)
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.classList.contains('light')).toBe(false)
  })

  it('resets --theme-chroma to 0 when switching to a neutral preset', async () => {
    const store = await createThemedStore()
    const { setTheme } = await import('./slices/themeSlice')

    store.dispatch(setTheme('rose'))
    expect(
      Number(document.documentElement.style.getPropertyValue('--theme-chroma')),
    ).toBeGreaterThan(0)

    store.dispatch(setTheme('neutral-dark'))
    expect(
      document.documentElement.style.getPropertyValue('--theme-chroma'),
    ).toBe('0')
  })

  it('toggleMode flips .dark ↔ .light classes', async () => {
    const store = await createThemedStore()
    const { setTheme, toggleMode } = await import('./slices/themeSlice')

    // Start with a color preset so we can flip independently.
    store.dispatch(setTheme('violet'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    store.dispatch(toggleMode())
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.classList.contains('light')).toBe(true)

    store.dispatch(toggleMode())
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('applies persisted theme on ACTION_HYDRATE_COMPLETE', async () => {
    // Simulate storage-middleware finishing hydration with a saved color
    // preset. The listener reads `state.theme` at that instant and projects
    // it onto <html>. Without this path, first paint post-hydration is blank.
    const store = await createThemedStore()
    const { setTheme } = await import('./slices/themeSlice')

    // Seed state as if hydration just completed with a color preset.
    store.dispatch(setTheme('blue'))

    // Fire the hydrate-complete action explicitly (separate from setTheme).
    // Reset DOM first so we only observe the hydrate effect.
    const root = document.documentElement
    root.style.removeProperty('--theme-hue')
    root.style.removeProperty('--theme-chroma')
    root.classList.remove('dark', 'light')

    store.dispatch({ type: ACTION_HYDRATE_COMPLETE })

    expect(root.style.getPropertyValue('--theme-hue')).toBe('250')
    expect(
      Number(root.style.getPropertyValue('--theme-chroma')),
    ).toBeGreaterThan(0)
    expect(root.classList.contains('dark')).toBe(true)
  })

  it('rapid preset switches leave the DOM matching the final state', async () => {
    // Regression guard for the "stale listener write" class of bug — if the
    // listener ever queues async writes, the final DOM could differ from the
    // last dispatched preset. Synchronous dispatch should land deterministically.
    const store = await createThemedStore()
    const { setTheme } = await import('./slices/themeSlice')

    store.dispatch(setTheme('rose'))
    store.dispatch(setTheme('cyan'))
    store.dispatch(setTheme('violet'))
    store.dispatch(setTheme('neutral-light'))

    const root = document.documentElement
    expect(root.style.getPropertyValue('--theme-hue')).toBe('0')
    expect(root.style.getPropertyValue('--theme-chroma')).toBe('0')
    expect(root.classList.contains('light')).toBe(true)
    expect(root.classList.contains('dark')).toBe(false)
    expect(store.getState().theme.preset).toBe('neutral-light')
  })
})
