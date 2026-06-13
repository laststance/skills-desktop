import { useCallback, useEffect, useMemo, useRef } from 'react'

/**
 * Returns a stable debounced wrapper around `callback`. Calling `run(...)`
 * (re)starts a timer; only the final `run` within a `delayMs` quiet window
 * actually fires. Exists so an event handler can trigger an expensive action —
 * e.g. a remote search — directly as the user types, without one call per
 * keystroke and without a value-watching effect. `cancel()` drops any pending
 * call (e.g. when the search box is cleared); the timer is also cleared on
 * unmount. Pass a stable `callback` (wrap in `useCallback`) so a scheduled run
 * never fires a stale closure. Used by `MarketplaceSearch` for incremental search.
 *
 * @param callback - The function to debounce; receives `run`'s arguments.
 * @param delayMs - Quiet period, in ms, before a scheduled call fires.
 * @returns
 * - `run(...args)`: schedule `callback(...args)` after the quiet period
 * - `cancel()`: drop any scheduled-but-unfired call
 * @example
 * const search = useDebouncedCallback((q: string) => dispatch(searchSkills(q)), 300)
 * onChange={(e) => search.run(e.target.value)}
 */
export function useDebouncedCallback<TArgs extends readonly unknown[]>(
  callback: (...args: TArgs) => void,
  delayMs: number,
): { run: (...args: TArgs) => void; cancel: () => void } {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback((): void => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const run = useCallback(
    (...args: TArgs): void => {
      // Restart the quiet window on every call, so only the last one in a burst
      // survives to fire.
      cancel()
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null
        callback(...args)
      }, delayMs)
    },
    [callback, delayMs, cancel],
  )

  // Drop any pending call when the consumer unmounts.
  useEffect(() => cancel, [cancel])

  return useMemo(() => ({ run, cancel }), [run, cancel])
}
