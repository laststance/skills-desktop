import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it } from 'vitest'

async function createTestStore() {
  const { default: themeReducer } = await import('./themeSlice')
  return configureStore({ reducer: { theme: themeReducer } })
}

describe('themeSlice', () => {
  it('has correct initial state', async () => {
    const store = await createTestStore()
    const state = store.getState().theme
    expect(state.hue).toBe(195)
    expect(state.mode).toBe('dark')
    expect(state.preset).toBe('neutral-dark')
    expect(state.presetType).toBe('neutral')
  })

  it('setTheme replaces all theme fields', async () => {
    const { setTheme } = await import('./themeSlice')
    const store = await createTestStore()
    store.dispatch(
      setTheme({
        hue: 300,
        mode: 'light',
        preset: 'violet',
        presetType: 'color',
      }),
    )
    const state = store.getState().theme
    expect(state.hue).toBe(300)
    expect(state.mode).toBe('light')
    expect(state.preset).toBe('violet')
    expect(state.presetType).toBe('color')
  })

  it('toggleMode switches dark to light for color themes', async () => {
    const { setColorTheme, toggleMode } = await import('./themeSlice')
    const store = await createTestStore()
    store.dispatch(setColorTheme({ preset: 'cyan', hue: 195 }))
    expect(store.getState().theme.mode).toBe('dark')

    store.dispatch(toggleMode())
    expect(store.getState().theme.mode).toBe('light')

    store.dispatch(toggleMode())
    expect(store.getState().theme.mode).toBe('dark')
  })

  it('toggleMode is no-op for neutral themes', async () => {
    const { toggleMode } = await import('./themeSlice')
    const store = await createTestStore()
    // Initial state is neutral-dark
    expect(store.getState().theme.presetType).toBe('neutral')

    store.dispatch(toggleMode())
    // Mode should not change for neutral preset
    expect(store.getState().theme.mode).toBe('dark')
  })

  it('setColorTheme updates preset, hue, and presetType', async () => {
    const { setColorTheme } = await import('./themeSlice')
    const store = await createTestStore()
    store.dispatch(setColorTheme({ preset: 'green', hue: 145 }))

    const state = store.getState().theme
    expect(state.preset).toBe('green')
    expect(state.hue).toBe(145)
    expect(state.presetType).toBe('color')
  })

  it('setNeutralTheme updates preset, mode, and presetType', async () => {
    const { setNeutralTheme } = await import('./themeSlice')
    const store = await createTestStore()
    store.dispatch(setNeutralTheme({ preset: 'neutral-light', mode: 'light' }))

    const state = store.getState().theme
    expect(state.preset).toBe('neutral-light')
    expect(state.mode).toBe('light')
    expect(state.presetType).toBe('neutral')
  })

  it('toggleMode is no-op for neutral-light themes', async () => {
    const { setNeutralTheme, toggleMode } = await import('./themeSlice')
    const store = await createTestStore()
    store.dispatch(setNeutralTheme({ preset: 'neutral-light', mode: 'light' }))
    expect(store.getState().theme.presetType).toBe('neutral')

    store.dispatch(toggleMode())
    expect(store.getState().theme.mode).toBe('light')
  })
})
