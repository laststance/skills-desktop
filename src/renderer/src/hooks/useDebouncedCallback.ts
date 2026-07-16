import { useEffect, useRef } from 'react'

/**
 * Returns a stable debounced wrapper around `callback`. Calling `run(...)`
 * (re)starts a timer; only the final `run` within a `delayMs` quiet window
 * actually fires. Exists so an event handler can trigger an expensive action —
 * e.g. a remote search — directly as the user types, without one call per
 * keystroke and without a value-watching effect. `cancel()` drops any pending
 * call (e.g. when the search box is cleared); the timer is also cleared on
 * unmount.
 *
 * The returned `{ run, cancel }` object and both methods are referentially
 * stable for the lifetime of the hook (created once via refs). Callers may
 * pass an inline `callback` — the latest closure is always read through a
 * ref. Used by `MarketplaceSearch` and `useDraftRangeSetting`.
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
  // Keep the latest callback and delay without putting them in run/cancel identity.
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const delayMsRef = useRef(delayMs)
  delayMsRef.current = delayMs

  // Create the public API once so consumers can put it in effect deps safely.
  const apiRef = useRef<{
    run: (...args: TArgs) => void
    cancel: () => void
  } | null>(null)

  if (apiRef.current === null) {
    const cancel = (): void => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    const run = (...args: TArgs): void => {
      // Restart the quiet window on every call, so only the last one in a burst
      // survives to fire.
      cancel()
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null
        callbackRef.current(...args)
      }, delayMsRef.current)
    }

    apiRef.current = { run, cancel }
  }

  // Drop any pending call when the consumer unmounts.
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [])

  return apiRef.current
}
