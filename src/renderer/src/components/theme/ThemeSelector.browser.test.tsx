import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '../ui/tooltip'

/**
 * Browser-mode tests for the ThemeSelector dropdown. Runs in Chromium so the
 * Radix DropdownMenu portal, focus trap, and click-through-to-menuitem path
 * exercise the real browser event loop (jsdom's pointer event model silently
 * skips Radix's `pointerdown` heuristics, which is how the same test in
 * happy-dom would pass even if the menu never opened).
 *
 * Covers the user-visible contract:
 *  - Trigger is reachable by accessible name (screen-reader path)
 *  - All 14 presets render as buttons with stable aria-labels
 *  - Clicking a swatch dispatches setTheme and flips aria-pressed
 *  - Neutral presets force chroma=0 and mode side-effects
 *  - Mode toggle (menuitem) dispatches toggleMode
 */

async function createStore() {
  const { default: themeReducer } =
    await import('../../redux/slices/themeSlice')
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

describe('ThemeSelector — dropdown open + preset grid', () => {
  it('renders the trigger button with an accessible name', async () => {
    const { screen } = await renderThemeSelector()

    await expect
      .element(screen.getByRole('button', { name: /Theme and color options/i }))
      .toBeInTheDocument()
  })

  it('renders all 12 color preset buttons when the menu opens', async () => {
    const { screen } = await renderThemeSelector()

    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()

    const colorLabels = [
      'Rose',
      'Orange',
      'Amber',
      'Yellow',
      'Lime',
      'Green',
      'Teal',
      'Cyan',
      'Sky',
      'Blue',
      'Indigo',
      'Violet',
    ]
    for (const label of colorLabels) {
      await expect
        .element(screen.getByRole('button', { name: `Select ${label} theme` }))
        .toBeInTheDocument()
    }
  })

  it('renders both neutral preset buttons when the menu opens', async () => {
    const { screen } = await renderThemeSelector()

    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()

    await expect
      .element(
        screen.getByRole('button', { name: 'Select Neutral Dark theme' }),
      )
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByRole('button', { name: 'Select Neutral Light theme' }),
      )
      .toBeInTheDocument()
  })

  it('clicking a color swatch dispatches setTheme(presetName) with correct hue/chroma', async () => {
    const { screen, store } = await renderThemeSelector()

    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()
    await screen.getByRole('button', { name: 'Select Cyan theme' }).click()

    const { theme } = store.getState()
    expect(theme.preset).toBe('cyan')
    expect(theme.hue).toBe(195)
    expect(theme.chroma).toBeGreaterThan(0)
  })

  it('aria-pressed reflects the currently selected preset', async () => {
    // Seed state with `rose` before opening the menu so the component reads
    // a non-default preset on first render inside the portal. This guards
    // against the regression where aria-pressed was hard-wired to the
    // initial render and never updated on preset change.
    const { screen, store } = await renderThemeSelector()
    const { setTheme } = await import('../../redux/slices/themeSlice')

    store.dispatch(setTheme('rose'))

    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()

    await expect
      .element(screen.getByRole('button', { name: 'Select Rose theme' }))
      .toHaveAttribute('aria-pressed', 'true')
    await expect
      .element(screen.getByRole('button', { name: 'Select Cyan theme' }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking a neutral preset forces chroma=0 and sets mode to match', async () => {
    const { screen, store } = await renderThemeSelector()

    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()
    await screen
      .getByRole('button', { name: 'Select Neutral Light theme' })
      .click()

    const { theme } = store.getState()
    expect(theme.preset).toBe('neutral-light')
    expect(theme.chroma).toBe(0)
    expect(theme.mode).toBe('light')
  })

  it('the mode-toggle menuitem dispatches toggleMode (dark → light)', async () => {
    // Default state is mode=dark, so the toggle menuitem reads "Switch to
    // Light". Clicking it flips mode to light and the label would become
    // "Switch to Dark" on the next open.
    const { screen, store } = await renderThemeSelector()

    await screen
      .getByRole('button', { name: /Theme and color options/i })
      .click()
    await screen.getByRole('menuitem', { name: /Switch to Light/i }).click()

    expect(store.getState().theme.mode).toBe('light')
  })
})
