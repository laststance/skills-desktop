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
 * Format install count for display
 * @param count - Raw install count number
 * @returns Formatted string with K/M suffix
 * @example
 * formatInstallCount(72900) // => "72.9K"
 * formatInstallCount(undefined) // => "—"
 */
export function formatInstallCount(count: number | undefined): string {
  if (!count) return '—'
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return count.toString()
}
