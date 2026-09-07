/** Removes Electron's transport wrapper from safe Main errors before gallery controls or toasts display them.
 * @returns Useful size/recovery guidance, or the caller's fallback for non-Error failures.
 * @example backgroundErrorMessage(new Error("Error invoking remote method 'backgrounds:importImage': Error: Image is too small."), 'Try again.') // 'Image is too small.'
 */
export function backgroundErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method 'backgrounds:[^']+': (?:Error: )?/,
        '',
      ) || fallback
    : fallback
}
