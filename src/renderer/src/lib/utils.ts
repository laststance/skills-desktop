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
