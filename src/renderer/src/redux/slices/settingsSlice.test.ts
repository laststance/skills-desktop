import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it } from 'vitest'

import type { RootState } from '@/renderer/src/redux/store'
import { DEFAULT_SETTINGS } from '@/shared/settings'

/**
 * Unit tests for the renderer-side settings cache. The slice itself is
 * intentionally minimal (single idempotent `setSettings` reducer), so
 * the contract worth pinning here is twofold:
 *  - the slice initializes from `DEFAULT_SETTINGS` (including the new
 *    empty `hiddenAgentIds`)
 *  - `selectHiddenAgentIds` returns the same array reference held in
 *    state so React-Redux's default reference equality skips re-renders
 *    when the underlying array hasn't changed
 *
 * Dynamic imports follow the pattern established by the other slice
 * test files so each test starts from a pristine reducer.
 */
async function createTestStore() {
  const { default: settingsReducer } = await import('./settingsSlice')
  return configureStore({ reducer: { settings: settingsReducer } })
}

describe('settingsSlice', () => {
  it('starts from the default settings with no agents hidden', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const settings = store.getState().settings

    // Assert
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(settings.hiddenAgentIds).toEqual([])
  })

  it('applies an updated settings object so the new tab and hidden agents take effect', async () => {
    // Arrange
    const { setSettings } = await import('./settingsSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(
      setSettings({
        ...DEFAULT_SETTINGS,
        defaultSkillTab: 'info',
        hiddenAgentIds: ['claude-code'],
      }),
    )

    // Assert
    expect(store.getState().settings.defaultSkillTab).toBe('info')
    expect(store.getState().settings.hiddenAgentIds).toEqual(['claude-code'])
  })
})

/**
 * `selectHiddenAgentIds` is the single read site for sidebar / settings
 * components. Two tests pin the contract:
 *  - it returns the array as-is (no copy / sort / dedupe)
 *  - it preserves reference identity across reads so React-Redux's
 *    default `===` comparison can short-circuit downstream re-renders
 */
describe('selectHiddenAgentIds', () => {
  it('exposes the persisted hidden agents exactly as stored', async () => {
    // Arrange
    const { selectHiddenAgentIds } = await import('./settingsSlice')
    const { setSettings } = await import('./settingsSlice')
    const store = await createTestStore()
    store.dispatch(
      setSettings({
        ...DEFAULT_SETTINGS,
        hiddenAgentIds: ['claude-code', 'cursor'],
      }),
    )

    // Act
    const hiddenAgentIds = selectHiddenAgentIds(store.getState() as RootState)

    // Assert
    expect(hiddenAgentIds).toEqual(['claude-code', 'cursor'])
  })

  it('returns a stable array reference between reads so subscribers skip needless re-renders', async () => {
    // Arrange
    const { selectHiddenAgentIds } = await import('./settingsSlice')
    const store = await createTestStore()

    // Act
    const firstRead = selectHiddenAgentIds(store.getState() as RootState)
    const secondRead = selectHiddenAgentIds(store.getState() as RootState)

    // Assert
    expect(firstRead).toBe(secondRead)
  })
})
