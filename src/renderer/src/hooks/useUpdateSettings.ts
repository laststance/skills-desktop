import { useCallback } from 'react'

import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import { setSettings } from '@/renderer/src/redux/slices/settingsSlice'
import type { Settings } from '@/shared/settings'

/**
 * Encapsulates the optimistic-dispatch + IPC-write pair used whenever
 * the renderer mutates a settings field. Two separate components
 * (Settings → General, main-window → SkillDetail) edit the same
 * `defaultSkillTab` field and were carrying near-identical handlers;
 * this hook is the single home for the pattern so future settings
 * additions don't have to re-derive the merge order.
 *
 * Flow on call:
 *  1. Dispatch `setSettings(merged)` locally so the UI reflects the
 *     change without waiting on an IPC round-trip.
 *  2. Fire `settings:set` to the main process. Main writes the JSON
 *     atomically and then broadcasts `settings:changed` back to every
 *     window (including this one), where `useSettingsSync` dispatches
 *     `setSettings` a second time — idempotent replace.
 *
 * The optimistic dispatch is safe because in-process Electron IPC
 * doesn't fail in practice; if main throws on validation the cache
 * stays out of sync until the next broadcast or window reload, which
 * is acceptable for non-critical settings.
 * @returns A stable function that takes a partial Settings update and applies it locally + remotely.
 * @example
 * const updateSettings = useUpdateSettings()
 * updateSettings({ defaultSkillTab: 'info' })
 */
export function useUpdateSettings(): (partial: Partial<Settings>) => void {
  const dispatch = useAppDispatch()
  const settings = useAppSelector((state) => state.settings)

  return useCallback(
    (partial: Partial<Settings>): void => {
      dispatch(setSettings({ ...settings, ...partial }))
      void window.electron.settings.set(partial)
    },
    [dispatch, settings],
  )
}
