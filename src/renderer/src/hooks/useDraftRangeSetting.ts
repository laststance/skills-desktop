import { useRef, useState } from 'react'

import { useDebouncedCallback } from './useDebouncedCallback'
import { useUpdateEffect } from './useUpdateEffect'

/**
 * Local draft + debounced persist for one numeric range setting.
 */
interface UseDraftRangeSettingResult {
  /** Current draft value, updated instantly on each change for a responsive slider. */
  draft: number
  /** True when the draft equals the setting's default (e.g. to disable Reset). */
  isDefault: boolean
  /** Update the draft now and schedule a debounced persist. */
  change: (next: number) => void
  /** Cancel any pending persist, snap the draft to the default, persist immediately. */
  reset: () => void
}

/**
 * Drive a Settings range slider: the draft updates instantly so the slider
 * feels live, while `commit` is debounced so a drag's burst of ticks collapses
 * into a single persist. An external settings broadcast (or any `value` change)
 * cancels a pending persist and re-syncs the draft, so a drag that the main
 * process overrides never writes back. Backs the appearance sliders (blur,
 * markdown/code font size).
 *
 * @param value - The persisted value from Redux (source of truth).
 * @param defaultValue - The setting's default, used by `reset` and `isDefault`.
 * @param commit - Persists a value (e.g. `(px) => updateSettings({ codeFontSizePx: px })`). May be an inline closure; the latest is always used.
 * @param delayMs - Debounce quiet period before `commit` fires.
 * @returns `{ draft, isDefault, change, reset }`.
 * @example
 * const font = useDraftRangeSetting(codeFontSizePx, 13, (px) => updateSettings({ codeFontSizePx: px }), 120)
 * <input type="range" value={font.draft} onChange={(e) => font.change(Number(e.target.value))} />
 */
export function useDraftRangeSetting(
  value: number,
  defaultValue: number,
  commit: (next: number) => void,
  delayMs: number,
): UseDraftRangeSettingResult {
  const [draft, setDraft] = useState<number>(value)

  // Hold the latest commit so `change`/`reset` stay referentially stable even
  // when the consumer passes an inline closure (keeps the memo slider stable).
  const commitRef = useRef(commit)
  commitRef.current = commit
  const persist = (next: number): void => {
    commitRef.current(next)
  }
  const debouncedPersist = useDebouncedCallback(persist, delayMs)

  const change = (next: number): void => {
    setDraft(next)
    debouncedPersist.run(next)
  }

  const reset = (): void => {
    debouncedPersist.cancel()
    setDraft(defaultValue)
    persist(defaultValue)
  }

  // A broadcast (or any value change) wins over a pending local drag: drop the
  // scheduled persist and mirror the new source-of-truth value.
  useUpdateEffect(() => {
    debouncedPersist.cancel()
    setDraft(value)
  }, [value, debouncedPersist])

  return { draft, isDefault: draft === defaultValue, change, reset }
}
