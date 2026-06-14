import { useEffect, useRef } from 'react'

/**
 * Run a callback only when the component unmounts.
 *
 * This is for teardown that is independent from dependency changes, such as
 * clearing a timer created by event handlers elsewhere in the component.
 *
 * @param callback - Teardown work to run during unmount.
 * @returns Nothing; React invokes `callback` from the cleanup phase.
 * @example
 * useUnmountEffect(() => {
 *   window.clearTimeout(timerId)
 * })
 */
export function useUnmountEffect(callback: () => void): void {
  const callbackRef = useRef(callback)
  // Keep cleanup pointed at the newest callback before passive effects flush.
  callbackRef.current = callback

  // react-doctor-disable-next-line react-doctor/exhaustive-deps -- intentional unmount wrapper; the cleanup reads the LATEST callbackRef.current on purpose so handlers created after mount still run at teardown.
  useEffect(() => {
    return () => callbackRef.current()
  }, [])
}
