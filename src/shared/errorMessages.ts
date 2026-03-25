/**
 * Map raw error strings to user-friendly messages.
 * @param err - Raw error message from IPC or file system
 * @returns Human-readable error message
 * @example
 * friendlyErrorMessage('EACCES: permission denied') // "You don't have permission to do this."
 * friendlyErrorMessage('Some unknown error')         // "Something went wrong. Please try again."
 */
export function friendlyErrorMessage(err: string): string {
  if (err.includes('EACCES')) return "You don't have permission to do this."
  if (err.includes('ENOENT')) return 'The file or folder no longer exists.'
  if (err.includes('EEXIST')) return 'A file with this name already exists.'
  if (err.includes('ENOSPC')) return 'Not enough disk space.'
  if (err.includes('ETIMEDOUT'))
    return 'The operation timed out. Please try again.'
  if (err.includes('ENOTFOUND'))
    return 'Could not connect. Check your internet connection.'
  return 'Something went wrong. Please try again.'
}
