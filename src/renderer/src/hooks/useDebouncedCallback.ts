import { useEffect, useRef } from 'react'

/**
 * Collapses input bursts for search and {@link useDraftRangeSetting}; sliders can flush completed gestures without changing search cancellation.
 * @returns Stable run, cancel and flush functions; unmount cancels pending work.
 * @example const save = useDebouncedCallback(persist, 120); save.run(85); save.flush()
 */
export function useDebouncedCallback<TArgs extends readonly unknown[]>(
  callback: (...args: TArgs) => void,
  delayMs: number,
): { run: (...args: TArgs) => void; cancel: () => void; flush: () => void } {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingArgsRef = useRef<TArgs | null>(null)
  // Keep the latest callback and delay without putting them in run/cancel identity.
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const delayMsRef = useRef(delayMs)
  delayMsRef.current = delayMs

  // Create the public API once so consumers can put it in effect deps safely.
  const apiRef = useRef<{
    run: (...args: TArgs) => void
    cancel: () => void
    flush: () => void
  } | null>(null)

  if (apiRef.current === null) {
    const cancel = (): void => {
      pendingArgsRef.current = null
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    const flush = (): void => {
      const args = pendingArgsRef.current
      cancel()
      // Cancelled or already-saved gestures must not write again on blur or keyup.
      if (args !== null) callbackRef.current(...args)
    }

    const run = (...args: TArgs): void => {
      // Restart the quiet window on every call, so only the last one in a burst
      // survives to fire.
      cancel()
      pendingArgsRef.current = args
      timeoutRef.current = setTimeout(flush, delayMsRef.current)
    }

    apiRef.current = { run, cancel, flush }
  }

  // Drop any pending call when the consumer unmounts.
  useEffect(() => {
    return () => {
      pendingArgsRef.current = null
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [])

  return apiRef.current
}
