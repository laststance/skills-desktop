/**
 * Map raw error values to user-friendly messages.
 * Accepts unknown type for defensive handling at system boundaries.
 * @param err - Raw error message from IPC or file system
 * @returns Human-readable error message
 * @example
 * friendlyErrorMessage('EACCES: permission denied') // "You don't have permission to do this."
 * friendlyErrorMessage(new Error('ENOENT'))          // "The file or folder no longer exists."
 * friendlyErrorMessage(42)                            // "Something went wrong. Please try again."
 */
export function friendlyErrorMessage(err: unknown): string {
  const message =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : String(err ?? '')
  if (message.includes('EACCES')) return "You don't have permission to do this."
  if (message.includes('ENOENT')) return 'The file or folder no longer exists.'
  if (message.includes('EEXIST')) return 'A file with this name already exists.'
  if (message.includes('ENOSPC')) return 'Not enough disk space.'
  if (message.includes('ETIMEDOUT'))
    return 'The operation timed out. Please try again.'
  if (message.includes('ENOTFOUND'))
    return 'Could not connect. Check your internet connection.'
  return 'Something went wrong. Please try again.'
}
