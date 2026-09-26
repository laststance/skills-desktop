/**
 * Extract a human-readable error message from an unknown error.
 * Commonly used in IPC handler catch blocks to normalize error types.
 * @param error - The caught error (unknown type)
 * @param fallback - Default message when error is not an Error instance
 * @returns The error message string
 * @example
 * extractErrorMessage(new Error('disk full'))     // => 'disk full'
 * extractErrorMessage('string error')             // => 'Unknown error occurred'
 * extractErrorMessage(null, 'Custom fallback')    // => 'Custom fallback'
 */
export function extractErrorMessage(
  error: unknown,
  fallback = 'Unknown error occurred',
): string {
  return error instanceof Error ? error.message : fallback
}
