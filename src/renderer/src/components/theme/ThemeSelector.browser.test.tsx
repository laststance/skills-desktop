import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'

/**
 * Browser-mode tests for the ThemeSelector dropdown (Pattern 1: Mode-First
 * Compact). Runs in Chromium so the Radix DropdownMenu portal, focus trap,
 * and click-through-to-control paths exercise the real browser event loop
 * (jsdom's pointer event model silently skips Radix's `pointerdown`
 * heuristics, which is how the same test in happy-dom would pass even if
 * the menu never opened).
 *
 * Covers the user-visible contract:
 *  - Trigger is reachable by accessible name (screen-reader path)
 *  - All 17 accent swatch buttons render with stable aria-labels
 *  - All 5 tinted-neutral family swatches render (Neutral / Zinc / Slate / Stone / Mauve)
 *  - Header shows the active preset name in mono
 *  - Light / Dark / Auto segmented control dispatches setModePreference
 *  - Clicking a family swatch resolves to the dark/light partner matching
 *    state.mode (no surprise mode flip)
 */

async function createStore() {
  const { default: themeReducer } =
    await import('@/renderer/src/redux/slices/themeSlice')
  return configureStore({
    reducer: { theme: themeReducer },
  })
}

async function renderThemeSelector() {
  const store = await createStore()
  const { ThemeSelector } = await import('./ThemeSelector')
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <ThemeSelector />
      </TooltipProvider>
    </Provider>,
  )
  return { screen, store }
}

describe('ThemeSelector — Pattern 1 layout', () => {
  it('renders the trigger button with an accessible name', async () => {
    const { screen } = await renderThemeSelector()

    await expect
      .element(screen.getByRole('button', { name: /Theme and color options/i }))
      .toBeInTheDocument()
  })

  it('renders all 17 accent swatch buttons when the menu opens', async () => {
    // Arrange
    const { screen } = await renderThemeSelector()

    // Act
    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()

    // Assert — hardcode the full 17-color list so a future regression that
    // silently drops a hue surfaces as a concrete missing-label failure
    // rather than an opaque "expected 17, got 16" length mismatch.
    const accentLabels = [
      'Rose',
      'Pink',
      'Red',
      'Orange',
      'Amber',
      'Yellow',
      'Lime',
      'Green',
      'Emerald',
      'Teal',
      'Cyan',
      'Sky',
      'Blue',
      'Indigo',
      'Violet',
      'Fuchsia',
      'Magenta',
    ]
    for (const label of accentLabels) {
      await expect
        .element(screen.getByRole('button', { name: `Select ${label} theme` }))
        .toBeInTheDocument()
    }
  })

  it('renders 5 tinted-neutral family swatches when the menu opens', async () => {
    // Arrange
    const { screen } = await renderThemeSelector()

    // Act
    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()

    // Assert — one button per family. Mode is resolved at click time, so
    // there's no "Dark"/"Light" suffix in the accessible name.
    for (const familyLabel of ['Neutral', 'Zinc', 'Slate', 'Stone', 'Mauve']) {
      await expect
        .element(
          screen.getByRole('button', { name: `Select ${familyLabel} theme` }),
        )
        .toBeInTheDocument()
    }
  })

  it('header displays the current preset label in mono', async () => {
    // Arrange — initial preset is neutral-dark whose THEME_PRESETS label is
    // "Neutral Dark", so the header should read that verbatim. `exact: true`
    // discriminates against the sr-only "Current theme: Neutral Dark" span
    // which also contains the substring.
    const { screen } = await renderThemeSelector()

    // Act
    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()

    // Assert
    await expect
      .element(screen.getByText('Neutral Dark', { exact: true }))
      .toBeInTheDocument()
  })

  it('clicking a color swatch dispatches setTheme(presetName) with correct hue/chroma', async () => {
    // Arrange
    const { screen, store } = await renderThemeSelector()
    const { THEME_PRESETS } = await import('@/shared/constants')

    // Act
    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()
    await screen.getByRole('button', { name: 'Select Cyan theme' }).click()

    // Assert
    const { theme } = store.getState()
    expect(theme.preset).toBe('cyan')
    expect(theme.hue).toBe(THEME_PRESETS.cyan.hue)
    expect(theme.chroma).toBe(THEME_PRESETS.cyan.chroma)
  })

  it('aria-pressed reflects the currently selected color preset', async () => {
    // Arrange — seed a non-default preset before opening the menu so the
    // component reads it on first render. Guards against a regression where
    // aria-pressed was hard-wired to the initial state and never updated.
    const { screen, store } = await renderThemeSelector()
    const { setTheme } = await import('@/renderer/src/redux/slices/themeSlice')
    store.dispatch(setTheme('rose'))

    // Act
    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()

    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Select Rose theme' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect
      .element(screen.getByRole('button', { name: 'Select Cyan theme' }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking Zinc family in Dark mode dispatches setTheme("zinc-dark")', async () => {
    // Arrange — initial mode is dark; user opens the dropdown.
    const { screen, store } = await renderThemeSelector()

    // Act
    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()
    await screen.getByRole('button', { name: 'Select Zinc theme' }).click()

    // Assert — family swatch resolved to the dark partner.
    const { theme } = store.getState()
    expect(theme.preset).toBe('zinc-dark')
    expect(theme.mode).toBe('dark')
  })

  it('clicking Zinc family in Light mode dispatches setTheme("zinc-light")', async () => {
    // Arrange — pin Light before opening the menu.
    const { screen, store } = await renderThemeSelector()
    const { setModePreference } =
      await import('@/renderer/src/redux/slices/themeSlice')
    store.dispatch(setModePreference('light'))

    // Act
    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()
    await screen.getByRole('button', { name: 'Select Zinc theme' }).click()

    // Assert
    const { theme } = store.getState()
    expect(theme.preset).toBe('zinc-light')
    expect(theme.mode).toBe('light')
  })

  it('clicking the Light segmented item dispatches setModePreference("light")', async () => {
    // Arrange
    const { screen, store } = await renderThemeSelector()
    expect(store.getState().theme.modePreference).toBe('dark')

    // Act
    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()
    await screen.getByRole('radio', { name: 'Light mode' }).click()

    // Assert
    expect(store.getState().theme.mode).toBe('light')
    expect(store.getState().theme.modePreference).toBe('light')
  })

  it('clicking the Dark segmented item dispatches setModePreference("dark")', async () => {
    // Arrange — start from Light so the Dark click is observable.
    const { screen, store } = await renderThemeSelector()
    const { setModePreference } =
      await import('@/renderer/src/redux/slices/themeSlice')
    store.dispatch(setModePreference('light'))

    // Act
    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()
    await screen.getByRole('radio', { name: 'Dark mode' }).click()

    // Assert
    expect(store.getState().theme.mode).toBe('dark')
    expect(store.getState().theme.modePreference).toBe('dark')
  })

  it('clicking the Auto segmented item dispatches setModePreference("system")', async () => {
    // Arrange
    const { screen, store } = await renderThemeSelector()

    // Act
    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()
    await screen.getByRole('radio', { name: 'System mode' }).click()

    // Assert — modePreference is persisted; mode is the OS-resolved value
    // (Chromium reports whatever the test runner's OS appearance is, so we
    // only assert on modePreference here to keep the test environment-agnostic).
    expect(store.getState().theme.modePreference).toBe('system')
  })
})
