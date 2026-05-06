import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind classes with clsx
 * @param inputs - Class values to merge
 * @returns Merged class string
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/**
 * Primitive types comparable by `===`. Constrains `toggleArrayMember`
 * so an object literal can never silently slip through the reference-
 * equality check (e.g. `toggleArrayMember([{id:'a'}], {id:'a'})` would
 * always append, never remove — caught at compile time now).
 */
type Primitive = string | number | boolean | bigint | symbol | null | undefined

/**
 * Toggle membership of `value` in `arr`. Returns a new array with the
 * value appended if absent, or removed if present. Always returns a
 * fresh reference so callers can pass the result straight into a Redux
 * setter / IPC payload without aliasing the previous state.
 *
 * Used by hide-from-sidebar flows where the next state is the inverse
 * of current membership (right-click toggle in `AgentItem`, checkbox
 * flip in Settings → Agents pane). Equality is `===`, so the generic
 * is constrained to `Primitive` — passing an object literal is a
 * compile-time error rather than a silent reference-equality bug.
 * @param arr - The current array (treated as immutable)
 * @param value - The value to toggle
 * @returns A new array with `value` appended or removed
 * @example
 * toggleArrayMember(['a', 'b'], 'c') // => ['a', 'b', 'c']
 * toggleArrayMember(['a', 'b'], 'a') // => ['b']
 */
export function toggleArrayMember<T extends Primitive>(
  arr: readonly T[],
  value: T,
): T[] {
  return arr.includes(value)
    ? arr.filter((item) => item !== value)
    : [...arr, value]
}

/**
 * Format install count for display with K/M suffixes.
 * Handles rounding overflow: values near 1M that round to "1000.0K"
 * are promoted to the M tier instead.
 * @param count - Raw install count number
 * @returns Formatted string with K/M suffix, or '—' for undefined
 * @example formatInstallCount(72900)     // => "72.9K"
 * @example formatInstallCount(999_950)   // => "1.0M"  (not "1000.0K")
 * @example formatInstallCount(undefined) // => "—"
 * @example formatInstallCount(0)         // => "0"
 */
export function formatInstallCount(count: number | undefined): string {
  if (count === undefined || count === null) return '—'
  const k = count / 1_000
  if (count >= 1_000_000 || Math.round(k * 10) / 10 >= 1_000) {
    return `${(count / 1_000_000).toFixed(1)}M`
  }
  if (count >= 1_000) return `${k.toFixed(1)}K`
  return count.toString()
}
