import { REPOSITORY_FACET_LABEL_MAX_CHARS } from '@/shared/constants'
import type { RepositoryId } from '@/shared/types'

/**
 * Compress a long repository slug for the COMPACT source-repo filter trigger
 * label, preserving both owner and repo clues via a middle ellipsis. Used only
 * by the trigger label (built in `selectSourceFilterViewModel`) — every
 * precision-first surface (dropdown rows, filter pills, aria-labels, and the
 * bulk-delete confirm dialog) shows the full untruncated value, because there
 * width is not constrained and knowing the exact repo matters more.
 * @param source - Repository slug, usually `owner/repo`.
 * @returns
 * - `source` unchanged when ≤ `REPOSITORY_FACET_LABEL_MAX_CHARS` (28) chars.
 * - Otherwise a middle-ellipsis form `<head>...<tail>` whose total length is
 *   exactly `REPOSITORY_FACET_LABEL_MAX_CHARS`; head and tail are derived from
 *   that constant (currently a 12-char head + "..." + 13-char tail = 28).
 * @example
 * formatRepositoryFacetLabel(repositoryId('vercel-labs/skills'))
 * // => "vercel-labs/skills"
 * formatRepositoryFacetLabel(repositoryId('very-long-owner-name/extremely-long-repository'))
 * // => "very-long-ow...ng-repository"
 */
export function formatRepositoryFacetLabel(source: RepositoryId): string {
  if (source.length <= REPOSITORY_FACET_LABEL_MAX_CHARS) return source
  // Derive the head/tail split from the budget so the truncated label is always
  // exactly REPOSITORY_FACET_LABEL_MAX_CHARS: changing the constant re-balances
  // both halves instead of silently breaking the head + "..." + tail = MAX
  // invariant. The head takes the floor so the tail keeps the odd remainder
  // (12 + 3 + 13 = 28 today), matching the documented example.
  const ellipsis = '...'
  const visibleCharBudget = REPOSITORY_FACET_LABEL_MAX_CHARS - ellipsis.length
  const headChars = Math.floor(visibleCharBudget / 2)
  const tailChars = visibleCharBudget - headChars
  return `${source.slice(0, headChars)}${ellipsis}${source.slice(-tailChars)}`
}
