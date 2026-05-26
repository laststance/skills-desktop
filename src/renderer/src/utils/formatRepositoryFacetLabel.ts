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
 * - Otherwise a middle-ellipsis form `<12-char head>...<13-char tail>` whose
 *   total length is exactly 28.
 * @example
 * formatRepositoryFacetLabel(repositoryId('vercel-labs/skills'))
 * // => "vercel-labs/skills"
 * formatRepositoryFacetLabel(repositoryId('very-long-owner-name/extremely-long-repository'))
 * // => "very-long-ow...ng-repository"
 */
export function formatRepositoryFacetLabel(source: RepositoryId): string {
  if (source.length <= REPOSITORY_FACET_LABEL_MAX_CHARS) return source
  // 12-char head + "..." + 13-char tail = 28-char REPOSITORY_FACET_LABEL_MAX_CHARS.
  return `${source.slice(0, 12)}...${source.slice(-13)}`
}
