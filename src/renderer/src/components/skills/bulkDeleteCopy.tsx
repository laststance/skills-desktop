import type React from 'react'

import type { SourceFilterSummary } from '@/renderer/src/redux/slices/uiSlice'
import { pluralize } from '@/renderer/src/utils/pluralize'

/**
 * Render the DialogDescription body for the bulk-delete confirm dialog.
 *
 * Every skill — including ones tracked in `~/.agents/.skill-lock.json` — is
 * trashed via `moveToTrash` with a 15s undo window. The CLI removal branch
 * was removed; lock-file entries are not rewritten by the desktop app.
 *
 * When a source-repo include filter is active, `sourceSummary` appends a scope
 * clause: which repositories the batch is drawn from, and how many source-less
 * local skills the filter is hiding (so the user knows those stay untouched).
 *
 * Extracted out of the JSX so the dialog render stays readable and so the
 * copy stays testable without mounting the full MainContent tree.
 *
 * @param totalCount - Total skills in the pending batch.
 * @param sourceSummary - Active repo-filter scope snapshot, or null when no
 *   repo filter is active and no local skills are hidden.
 * @returns
 * - Base trash + undo sentence (always present).
 * - `+ " Only skills from <repo> are in scope."` when ≥1 repo is in scope.
 * - `+ " N local skills hidden by the source filter are not affected."` when
 *   the filter suppresses source-less local skills.
 * @example
 * renderBulkDeleteDescription({ totalCount: 3, sourceSummary: null })
 * // => "This moves the skills to the app trash ... from the notification."
 * @example
 * renderBulkDeleteDescription({
 *   totalCount: 2,
 *   sourceSummary: {
 *     repositoryIds: [repositoryId('vercel-labs/skills')],
 *     localHiddenCount: 1,
 *   },
 * })
 * // => "... from the notification. Only skills from vercel-labs/skills are in
 * //     scope. 1 local skill hidden by the source filter is not affected."
 */
export const renderBulkDeleteDescription = ({
  totalCount,
  sourceSummary,
}: {
  totalCount: number
  sourceSummary: SourceFilterSummary | null
}): React.ReactNode => {
  const base = `This moves the ${pluralize(totalCount, 'skill')} to the app trash and removes every symlink pointing to ${pluralize(totalCount, 'it', 'them')}. You can restore within 15 seconds from the notification.`

  // No active repo filter (and nothing hidden) → the base copy is complete.
  if (sourceSummary === null) return base

  const scopeSentences: string[] = []
  // Name the repositories the batch is drawn from. A single repo is spelled in
  // full (NOT the truncated trigger label) — this is a destructive confirm, so
  // the user must see the exact source; many repos collapse to a count.
  if (sourceSummary.repositoryIds.length > 0) {
    const repoScope =
      sourceSummary.repositoryIds.length === 1
        ? sourceSummary.repositoryIds[0]
        : `the ${sourceSummary.repositoryIds.length} selected repositories`
    scopeSentences.push(`Only skills from ${repoScope} are in scope.`)
  }
  // Reassure that source-less local skills the filter hides stay untouched.
  if (sourceSummary.localHiddenCount > 0) {
    const { localHiddenCount } = sourceSummary
    scopeSentences.push(
      `${localHiddenCount} local ${pluralize(localHiddenCount, 'skill')} hidden by the source filter ${pluralize(localHiddenCount, 'is', 'are')} not affected.`,
    )
  }

  if (scopeSentences.length === 0) return base
  return `${base} ${scopeSentences.join(' ')}`
}
