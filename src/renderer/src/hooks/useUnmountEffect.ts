import { useEffect } from 'react'

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
  useEffect(() => {
    return () => callback()
  }, [])
}
