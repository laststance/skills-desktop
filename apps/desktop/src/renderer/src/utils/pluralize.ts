/**
 * Return the singular form when `count` is exactly 1, and the plural form
 * otherwise. Collapses the `count === 1 ? 'skill' : 'skills'` and the
 * `skill${count === 1 ? '' : 's'}` variants that were sprinkled across the
 * bulk-delete UI copy, so one edit (e.g., renaming "skill" to "plugin") hits
 * every surface.
 *
 * @param count - The cardinality driving the grammatical number
 * @param singular - The singular form (rendered when `count === 1`)
 * @param plural - Optional explicit plural; defaults to `singular + 's'` for regular English nouns
 * @returns `singular` when `count === 1`; otherwise `plural` (or `singular + 's'`)
 * @example
 * pluralize(1, 'skill')            // => 'skill'
 * pluralize(3, 'skill')            // => 'skills'
 * pluralize(2, 'entry', 'entries') // => 'entries'
 */
export function pluralize(
  count: number,
  singular: string,
  plural?: string,
): string {
  if (count === 1) return singular
  return plural ?? `${singular}s`
}
