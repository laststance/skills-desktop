import { configureStore } from '@reduxjs/toolkit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COLOR_PRESET_CHROMA, TINTED_NEUTRAL_CHROMA } from '@/shared/constants'

/**
 * `setModePreference('system')` reads `window.matchMedia('(prefers-color-scheme: dark)')`
 * to decide the resolved mode, so this file runs under happy-dom to get a
 * real `window` object — node-only would fall back to the hard-coded 'dark'
 * branch in `resolveMode` and the `'system' → light` cases below would all
 * silently pass with the wrong answer.
 *
 * @vitest-environment happy-dom
 */

async function createTestStore() {
  const { default: themeReducer } = await import('./themeSlice')
  return configureStore({ reducer: { theme: themeReducer } })
}

/**
 * Build a `window.matchMedia` stub that always reports a given system
 * preference. The stub mirrors only the subset of `MediaQueryList` that
 * `resolveMode` touches (`matches`, `addEventListener`, etc.) — full
 * compliance would be overkill for these reducer tests.
 */
function stubSystemPrefersDark(prefersDark: boolean): void {
  const matchMediaStub = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  // `resolveMode` reads `window.matchMedia` directly, so write to the
  // window — `vi.stubGlobal('matchMedia', ...)` alone would set the bare
  // global but not the property on the `window` instance happy-dom exposes.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMediaStub,
  })
}

describe('themeSlice', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('boots into the neutral-dark theme with no tint applied', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const state = store.getState().theme

    // Assert
    expect(state.hue).toBe(0)
    expect(state.chroma).toBe(0)
    expect(state.mode).toBe('dark')
    expect(state.modePreference).toBe('dark')
    expect(state.preset).toBe('neutral-dark')
  })

  it('tints the app to the chosen color swatch while keeping the current dark mode', async () => {
    // Arrange
    const { setTheme } = await import('./themeSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(setTheme('violet'))

    // Assert
    const state = store.getState().theme
    expect(state.preset).toBe('violet')
    expect(state.hue).toBe(300)
    expect(state.chroma).toBe(COLOR_PRESET_CHROMA)
    // Color preset keeps the current mode (dark initially)
    expect(state.mode).toBe('dark')
  })

  it('switches to light mode when the user picks the neutral-light preset', async () => {
    // Arrange
    const { setTheme } = await import('./themeSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(setTheme('neutral-light'))

    // Assert
    const state = store.getState().theme
    expect(state.preset).toBe('neutral-light')
    expect(state.chroma).toBe(0)
    expect(state.mode).toBe('light')
  })

  it('setTheme leaves modePreference untouched so an "Auto" user keeps tracking the OS', async () => {
    // Arrange — user picked Auto, the listener resolved to dark.
    const { setTheme, setModePreference } = await import('./themeSlice')
    stubSystemPrefersDark(true)
    const store = await createTestStore()
    store.dispatch(setModePreference('system'))
    expect(store.getState().theme.modePreference).toBe('system')

    // Act — user picks Cyan from the swatch grid.
    store.dispatch(setTheme('cyan'))

    // Assert — preset changed but modePreference is still 'system'.
    expect(store.getState().theme.preset).toBe('cyan')
    expect(store.getState().theme.modePreference).toBe('system')
  })

  it('setModePreference flips dark/light for color presets without losing preset', async () => {
    // Arrange
    const { setTheme, setModePreference } = await import('./themeSlice')
    const store = await createTestStore()
    store.dispatch(setTheme('cyan'))
    expect(store.getState().theme.mode).toBe('dark')

    // Act + Assert — pin Light, then Dark; preset stays cyan.
    store.dispatch(setModePreference('light'))
    expect(store.getState().theme.mode).toBe('light')
    expect(store.getState().theme.modePreference).toBe('light')
    expect(store.getState().theme.preset).toBe('cyan')

    store.dispatch(setModePreference('dark'))
    expect(store.getState().theme.mode).toBe('dark')
    expect(store.getState().theme.modePreference).toBe('dark')
    expect(store.getState().theme.preset).toBe('cyan')
  })

  it('setModePreference swaps neutral-dark ↔ neutral-light so the preset stays consistent with mode', async () => {
    // Arrange
    const { setModePreference } = await import('./themeSlice')
    const store = await createTestStore()

    // Act — initial preset is neutral-dark; pin Light.
    store.dispatch(setModePreference('light'))

    // Assert — preset key swapped to the light partner.
    expect(store.getState().theme.mode).toBe('light')
    expect(store.getState().theme.preset).toBe('neutral-light')

    store.dispatch(setModePreference('dark'))
    expect(store.getState().theme.mode).toBe('dark')
    expect(store.getState().theme.preset).toBe('neutral-dark')
  })

  // Tinted-neutral families ship as explicit dark/light pairs in
  // THEME_PRESETS (see constants.ts §"Tinted neutral"). Without the
  // partner-key swap, a user on `zinc-dark` who hits the mode toggle
  // would end up with `state.mode = 'light'` while `state.preset`
  // remained `zinc-dark`, breaking the dropdown's `aria-pressed`,
  // the sr-only "Current theme: …" announcement, and producing
  // mismatched persisted state on next launch.
  it.each([
    ['zinc-dark', 'zinc-light', 265],
    ['slate-dark', 'slate-light', 240],
    ['stone-dark', 'stone-light', 60],
    ['mauve-dark', 'mauve-light', 320],
    ['clay-dark', 'clay-light', 20],
    ['olive-dark', 'olive-light', 105],
    ['sage-dark', 'sage-light', 150],
    ['steel-dark', 'steel-light', 200],
    ['plum-dark', 'plum-light', 345],
  ] as const)(
    'setModePreference swaps %s ↔ %s so preset stays consistent with mode',
    async (darkPreset, lightPreset, expectedHue) => {
      const { setTheme, setModePreference } = await import('./themeSlice')
      const store = await createTestStore()

      store.dispatch(setTheme(darkPreset))
      expect(store.getState().theme.preset).toBe(darkPreset)
      expect(store.getState().theme.mode).toBe('dark')
      expect(store.getState().theme.hue).toBe(expectedHue)
      expect(store.getState().theme.chroma).toBe(TINTED_NEUTRAL_CHROMA)

      store.dispatch(setModePreference('light'))
      expect(store.getState().theme.mode).toBe('light')
      expect(store.getState().theme.preset).toBe(lightPreset)
      expect(store.getState().theme.hue).toBe(expectedHue)
      expect(store.getState().theme.chroma).toBe(TINTED_NEUTRAL_CHROMA)

      store.dispatch(setModePreference('dark'))
      expect(store.getState().theme.mode).toBe('dark')
      expect(store.getState().theme.preset).toBe(darkPreset)
    },
  )

  describe('setModePreference("system") — OS appearance resolution', () => {
    beforeEach(() => {
      // Each test re-stubs explicitly; clear any leftover stub here so
      // assertions about "what happens when OS is in Light" can't be
      // shadowed by a previous "OS in Dark" stub.
      vi.unstubAllGlobals()
    })

    it('resolves to dark when the OS reports prefers-color-scheme: dark', async () => {
      // Arrange
      stubSystemPrefersDark(true)
      const { setModePreference } = await import('./themeSlice')
      const store = await createTestStore()

      // Act
      store.dispatch(setModePreference('system'))

      // Assert — modePreference is persisted; mode is the OS-resolved value.
      expect(store.getState().theme.modePreference).toBe('system')
      expect(store.getState().theme.mode).toBe('dark')
    })

    it('resolves to light when the OS reports prefers-color-scheme: light', async () => {
      // Arrange
      stubSystemPrefersDark(false)
      const { setModePreference } = await import('./themeSlice')
      const store = await createTestStore()

      // Act
      store.dispatch(setModePreference('system'))

      // Assert
      expect(store.getState().theme.modePreference).toBe('system')
      expect(store.getState().theme.mode).toBe('light')
    })

    it('swaps neutral preset to partner when system resolves to a different mode than the current preset', async () => {
      // Arrange — start in zinc-dark, then move to Auto while the OS is Light.
      const { setTheme, setModePreference } = await import('./themeSlice')
      const store = await createTestStore()
      store.dispatch(setTheme('zinc-dark'))
      stubSystemPrefersDark(false)

      // Act
      store.dispatch(setModePreference('system'))

      // Assert — preset followed the OS-resolved mode.
      expect(store.getState().theme.mode).toBe('light')
      expect(store.getState().theme.preset).toBe('zinc-light')
      expect(store.getState().theme.modePreference).toBe('system')
    })

    it('leaves color presets untouched when system resolves to a new mode', async () => {
      // Arrange
      const { setTheme, setModePreference } = await import('./themeSlice')
      const store = await createTestStore()
      store.dispatch(setTheme('cyan'))
      stubSystemPrefersDark(false)

      // Act
      store.dispatch(setModePreference('system'))

      // Assert — cyan has no baked mode; only state.mode changes.
      expect(store.getState().theme.preset).toBe('cyan')
      expect(store.getState().theme.mode).toBe('light')
    })

    it('defaults Auto to dark in a headless host that has no matchMedia (SSR / pre-hydration safety net)', async () => {
      // Regression guard for the resolver's headless fallback: when a user is on
      // "Auto" but the host lacks `window.matchMedia` (SSR, the pre-hydration
      // bootstrap script, or a stripped test host), the reducer must stay total
      // and pick a safe palette instead of crashing on a missing API. Dark is
      // the chosen default so a flash-of-light is never shown on cold start.
      // Arrange — strip matchMedia so `typeof window.matchMedia !== 'function'`.
      const { setModePreference } = await import('./themeSlice')
      const store = await createTestStore()
      Reflect.deleteProperty(window, 'matchMedia')
      expect(typeof window.matchMedia).toBe('undefined')

      // Act — pick Auto with no OS-appearance API available to consult.
      store.dispatch(setModePreference('system'))

      // Assert — falls back to dark without touching matchMedia.
      expect(store.getState().theme.modePreference).toBe('system')
      expect(store.getState().theme.mode).toBe('dark')
    })
  })

  it('removes the color tint when switching from a color swatch back to a neutral preset', async () => {
    // Arrange
    const { setTheme } = await import('./themeSlice')
    const store = await createTestStore()

    // Act + Assert — a color preset applies chroma
    store.dispatch(setTheme('rose'))
    expect(store.getState().theme.chroma).toBe(COLOR_PRESET_CHROMA)

    // Act + Assert — switching to neutral drops chroma back to zero
    store.dispatch(setTheme('neutral-dark'))
    expect(store.getState().theme.chroma).toBe(0)
  })

  it('falls back to neutral-dark instead of crashing on a stale unknown preset key', async () => {
    // Guards against the "stale preset from disk" crash: if a user has
    // `preset: 'mono-dark'` (a name proposed in a plan but never shipped),
    // THEME_PRESETS[preset] is undefined and `config.hue` would throw. The
    // guard must short-circuit to neutral-dark before that access.
    // Arrange
    const { setTheme } = await import('./themeSlice')
    const store = await createTestStore()

    // Act — force-cast an invalid preset name. Migration has its own guard;
    // this exercises the reducer-level guard in case migration is bypassed
    // (e.g. a dev action dispatch, or a future slice that lets users type names).
    store.dispatch(setTheme('mono-dark' as never))

    // Assert
    const state = store.getState().theme
    expect(state.preset).toBe('neutral-dark')
    expect(state.chroma).toBe(0)
    expect(state.mode).toBe('dark')
  })
})
