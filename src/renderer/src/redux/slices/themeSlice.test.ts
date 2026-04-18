import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it } from 'vitest'

import { COLOR_PRESET_CHROMA } from '../../../../shared/constants'

async function createTestStore() {
  const { default: themeReducer } = await import('./themeSlice')
  return configureStore({ reducer: { theme: themeReducer } })
}

describe('themeSlice', () => {
  it('has correct initial state', async () => {
    const store = await createTestStore()
    const state = store.getState().theme
    expect(state.hue).toBe(0)
    expect(state.chroma).toBe(0)
    expect(state.mode).toBe('dark')
    expect(state.preset).toBe('neutral-dark')
  })

  it('setTheme applies hue and chroma from THEME_PRESETS for color presets', async () => {
    const { setTheme } = await import('./themeSlice')
    const store = await createTestStore()
    store.dispatch(setTheme('violet'))
    const state = store.getState().theme
    expect(state.preset).toBe('violet')
    expect(state.hue).toBe(300)
    expect(state.chroma).toBe(COLOR_PRESET_CHROMA)
    // Color preset keeps the current mode (dark initially)
    expect(state.mode).toBe('dark')
  })

  it('setTheme forces mode for neutral presets', async () => {
    const { setTheme } = await import('./themeSlice')
    const store = await createTestStore()
    store.dispatch(setTheme('neutral-light'))
    const state = store.getState().theme
    expect(state.preset).toBe('neutral-light')
    expect(state.chroma).toBe(0)
    expect(state.mode).toBe('light')
  })

  it('toggleMode flips dark/light for color presets without losing preset', async () => {
    const { setTheme, toggleMode } = await import('./themeSlice')
    const store = await createTestStore()
    store.dispatch(setTheme('cyan'))
    expect(store.getState().theme.mode).toBe('dark')
    store.dispatch(toggleMode())
    expect(store.getState().theme.mode).toBe('light')
    expect(store.getState().theme.preset).toBe('cyan')
    store.dispatch(toggleMode())
    expect(store.getState().theme.mode).toBe('dark')
    expect(store.getState().theme.preset).toBe('cyan')
  })

  it('toggleMode swaps neutral-dark ↔ neutral-light so the preset stays consistent with mode', async () => {
    const { toggleMode } = await import('./themeSlice')
    const store = await createTestStore()
    // Initial: neutral-dark
    store.dispatch(toggleMode())
    expect(store.getState().theme.mode).toBe('light')
    expect(store.getState().theme.preset).toBe('neutral-light')
    store.dispatch(toggleMode())
    expect(store.getState().theme.mode).toBe('dark')
    expect(store.getState().theme.preset).toBe('neutral-dark')
  })

  it('switching color → neutral drops chroma to 0', async () => {
    const { setTheme } = await import('./themeSlice')
    const store = await createTestStore()
    store.dispatch(setTheme('rose'))
    expect(store.getState().theme.chroma).toBe(COLOR_PRESET_CHROMA)
    store.dispatch(setTheme('neutral-dark'))
    expect(store.getState().theme.chroma).toBe(0)
  })

  it('setTheme falls back to neutral-dark when preset key is unknown', async () => {
    // Guards against the "stale preset from disk" crash: if a user has
    // `preset: 'mono-dark'` (a name proposed in a plan but never shipped),
    // THEME_PRESETS[preset] is undefined and `config.hue` would throw. The
    // guard must short-circuit to neutral-dark before that access.
    const { setTheme } = await import('./themeSlice')
    const store = await createTestStore()
    // Force-cast an invalid preset name. Migration has its own guard; this
    // exercises the reducer-level guard in case migration is bypassed (e.g.
    // a dev action dispatch, or a future slice that lets users type names).
    store.dispatch(setTheme('mono-dark' as never))
    const state = store.getState().theme
    expect(state.preset).toBe('neutral-dark')
    expect(state.chroma).toBe(0)
    expect(state.mode).toBe('dark')
  })
})
