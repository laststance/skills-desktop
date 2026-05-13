import { useEffect, type DependencyList, type EffectCallback } from 'react'

/**
 * Run a lifecycle effect with the exact semantics of React's `useEffect`.
 *
 * This is the general-purpose wrapper for mount plus dependency changes, while
 * preserving a searchable lifecycle name at call sites.
 *
 * @param effect - Work to run after render; may return a cleanup.
 * @param deps - Dependency list passed straight through to React.
 * @returns Nothing; React owns the optional cleanup returned by `effect`.
 * @example
 * useCycleEffect(() => {
 *   const unsubscribe = window.electron.settings.onChanged(sync)
 *   return unsubscribe
 * }, [sync])
 */
export function useCycleEffect(
  effect: EffectCallback,
  deps?: DependencyList,
): void {
  useEffect(effect, deps)
}
