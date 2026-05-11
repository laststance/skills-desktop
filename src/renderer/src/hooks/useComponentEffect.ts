import { useEffect, type DependencyList, type EffectCallback } from 'react'

/**
 * Runs a renderer side effect from a named hook boundary.
 *
 * The `@laststance/react-next/no-direct-use-effect` rule expects components to
 * call custom hooks instead of `useEffect` directly. This helper keeps legacy
 * component effects behavior-compatible while making the effect boundary
 * explicit and searchable during incremental refactors.
 *
 * @param effect - React effect callback to execute after render.
 * @param deps - Dependency list that controls when the effect re-runs.
 * @returns Nothing; mirrors React's `useEffect` return shape through `effect`.
 *
 * @example
 * useComponentEffect(() => {
 *   window.addEventListener('resize', onResize)
 *   return () => window.removeEventListener('resize', onResize)
 * }, [onResize])
 */
export function useComponentEffect(
  effect: EffectCallback,
  deps?: DependencyList,
): void {
  useEffect(effect, deps)
}
