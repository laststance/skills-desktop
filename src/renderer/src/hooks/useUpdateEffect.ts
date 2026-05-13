import {
  useEffect,
  useRef,
  type DependencyList,
  type EffectCallback,
} from 'react'

/**
 * Dependency list variant that rejects an empty array at compile time.
 */
type NonEmptyDependencyList = readonly [unknown, ...unknown[]]

/**
 * Run a React effect after re-renders while skipping the initial mount.
 *
 * Use this when local state is already initialized from props or Redux during
 * render, but still needs to respond to later broadcasts or dependency changes.
 *
 * @param effect - Work to run after a dependency changes post-mount.
 * @param deps - Dependency list that gates update-only re-runs.
 * @returns Nothing; React owns the optional cleanup returned by `effect`.
 * @example
 * useUpdateEffect(() => {
 *   setDraft(serverValue)
 * }, [serverValue])
 */
export function useUpdateEffect(effect: EffectCallback, deps?: undefined): void
export function useUpdateEffect(
  effect: EffectCallback,
  deps: NonEmptyDependencyList,
): void
export function useUpdateEffect(
  effect: EffectCallback,
  deps?: DependencyList,
): void {
  const hasMountedRef = useRef(false)

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return undefined
    }

    // Once mounted, mirror standard useEffect cleanup semantics.
    return effect()
  }, deps)
}
