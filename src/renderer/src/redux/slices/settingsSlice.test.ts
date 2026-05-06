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
  it('initial state matches DEFAULT_SETTINGS (with empty hiddenAgentIds)', async () => {
    const store = await createTestStore()
    expect(store.getState().settings).toEqual(DEFAULT_SETTINGS)
    expect(store.getState().settings.hiddenAgentIds).toEqual([])
  })

  it('setSettings replaces the entire settings object idempotently', async () => {
    const { setSettings } = await import('./settingsSlice')
    const store = await createTestStore()

    store.dispatch(
      setSettings({
        ...DEFAULT_SETTINGS,
        defaultSkillTab: 'info',
        hiddenAgentIds: ['claude-code'],
      }),
    )

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
  it('returns the persisted hiddenAgentIds array', async () => {
    const { selectHiddenAgentIds } = await import('./settingsSlice')
    const { setSettings } = await import('./settingsSlice')
    const store = await createTestStore()

    store.dispatch(
      setSettings({
        ...DEFAULT_SETTINGS,
        hiddenAgentIds: ['claude-code', 'cursor'],
      }),
    )

    expect(selectHiddenAgentIds(store.getState() as RootState)).toEqual([
      'claude-code',
      'cursor',
    ])
  })

  it('returns the same reference across consecutive reads when state is unchanged', async () => {
    const { selectHiddenAgentIds } = await import('./settingsSlice')
    const store = await createTestStore()

    const firstRead = selectHiddenAgentIds(store.getState() as RootState)
    const secondRead = selectHiddenAgentIds(store.getState() as RootState)
    expect(firstRead).toBe(secondRead)
  })
})
