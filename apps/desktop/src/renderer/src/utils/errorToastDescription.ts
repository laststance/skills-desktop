import type { SerializedError } from '@reduxjs/toolkit'

/**
 * Pull a user-displayable description string out of a rejected Redux Toolkit
 * thunk action. Collapses the three MainContent toast sites that repeated
 * `action.error?.message ?? 'Unexpected error'` verbatim, so the fallback copy
 * stays in lockstep across Bulk Delete / Bulk Unlink / Restore failures.
 *
 * @param action - A rejected thunk action (has `error: SerializedError`)
 * @returns The error message when present; otherwise the `'Unexpected error'` fallback
 * @example
 * toast.error('Bulk delete failed', {
 *   description: errorToastDescription(action),
 * })
 */
export function errorToastDescription(action: {
  error: SerializedError
}): string {
  // `||` instead of `??` so an empty-string message ("", e.g. a syscall that
  // threw with no text) falls through to the 'Unexpected error' copy. `??`
  // would happily render a blank description in the toast.
  return action.error.message || 'Unexpected error'
}
