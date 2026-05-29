/**
 * Extract `err.code` from an unknown thrown value — Node fs errors are
 * ErrnoException shaped, and ts-rules forbids `as NodeJS.ErrnoException`
 * casts. Use this helper wherever we need to branch on `ENOENT`, `EEXIST`,
 * etc. from a catch block.
 * @param error - The caught error (unknown type)
 * @returns The `code` string when present, else undefined
 * @example
 * try { await fs.rename(a, b) } catch (error) {
 *   if (errorCode(error) === 'ENOENT') return null
 *   throw error
 * }
 */
export function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

/**
 * Checks whether an fs probe proves a path component is gone; cleanup callers use it to avoid treating permission failures as dangling symlinks.
 * @param error - The caught filesystem error.
 * @returns True only for Node codes that mean the target path cannot exist.
 * @example
 * isMissingPathError(Object.assign(new Error('missing'), { code: 'ENOENT' })) // => true
 */
export function isMissingPathError(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
}
