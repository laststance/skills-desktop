import { useEffect, type DependencyList, type EffectCallback } from 'react'

/**
 * Dependency list variant that rejects an empty array at compile time.
 */
type NonEmptyDependencyList = readonly [unknown, ...unknown[]]

/**
 * Run an effect on every render, or on mount plus non-empty dependency changes.
 *
 * Omit `deps` for every committed render. Pass a non-empty dependency list for
 * standard mount-and-change behavior. Passing `[]` is intentionally a type
 * error; use `useInitialEffect` for mount-only work.
 *
 * @param effect - Work to run after render.
 * @param deps - Optional non-empty dependencies that gate re-runs.
 * @returns Nothing; React owns the optional cleanup returned by `effect`.
 * @example
 * useRenderEffect(() => {
 *   latestVisibleNamesRef.current = visibleNames
 * }, [visibleNames])
 */
export function useRenderEffect(effect: EffectCallback): void
export function useRenderEffect(
  effect: EffectCallback,
  deps: NonEmptyDependencyList,
): void
export function useRenderEffect(
  effect: EffectCallback,
  deps?: DependencyList,
): void {
  useEffect(effect, deps)
}
