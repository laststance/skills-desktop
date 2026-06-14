import { useEffect, type EffectCallback } from 'react'

/**
 * Run a React effect exactly once when the component mounts.
 *
 * This hook is the mount-only lifecycle boundary for effects that do not need
 * reactive dependencies after the first render. If `effect` returns a cleanup,
 * React runs that cleanup when the component unmounts.
 *
 * @param effect - Work to run after the first committed render.
 * @returns Nothing; React owns the optional cleanup returned by `effect`.
 * @example
 * useInitialEffect(() => {
 *   dispatch(fetchSkills())
 * })
 */
export function useInitialEffect(effect: EffectCallback): void {
  // react-doctor-disable-next-line react-doctor/exhaustive-deps -- intentional useEffect wrapper (repo's no-direct-use-effect layer); `effect` is a parameter react-doctor cannot statically verify.
  useEffect(effect, [])
}
