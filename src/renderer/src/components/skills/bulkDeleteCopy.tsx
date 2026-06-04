import type React from 'react'
import { match } from 'ts-pattern'

import type { SourceFilterSummary } from '@/renderer/src/redux/slices/uiSlice'
import { pluralize } from '@/renderer/src/utils/pluralize'

/**
 * Render the DialogDescription body for the bulk-delete confirm dialog.
 *
 * Source-backed skills are trashed with a 15s undo window; orphan rows remove
 * reviewed dangling symlinks directly and therefore have no undo toast.
 *
 * When a source-repo include filter is active, `sourceSummary` appends a scope
 * clause: which repositories the batch is drawn from, and how many source-less
 * local skills the filter is hiding (so the user knows those stay untouched).
 *
 * Extracted out of the JSX so the dialog render stays readable and so the
 * copy stays testable without mounting the full MainContent tree.
 *
 * @param totalCount - Total skills in the pending batch.
 * @param trashCount - Source-backed rows that produce tombstones and undo.
 * @param orphanCleanupCount - Orphan rows cleaned as dangling symlinks only.
 * @param staleDeleteCount - Source/local rows that need a fresh scan before delete.
 * @param orphanRescanCount - Stale orphan rows that need a fresh scan first.
 * @param sourceSummary - Active repo-filter scope snapshot, or null when no
 *   repo filter is active and no local skills are hidden.
 * @returns
 * - Trash + undo sentence for source rows, or no-undo cleanup copy for orphan rows.
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
  trashCount = totalCount,
  orphanCleanupCount = 0,
  staleDeleteCount = 0,
  orphanRescanCount = 0,
  sourceSummary,
}: {
  totalCount: number
  trashCount?: number
  orphanCleanupCount?: number
  staleDeleteCount?: number
  orphanRescanCount?: number
  sourceSummary: SourceFilterSummary | null
}): React.ReactNode => {
  const hasBaseTrashCopy =
    orphanCleanupCount === 0 &&
    orphanRescanCount === 0 &&
    staleDeleteCount === 0
  const hasTrashRows = trashCount > 0
  const hasOrphanCleanupRows = orphanCleanupCount > 0
  const hasOnlyOrphanRescan = orphanRescanCount > 0 && staleDeleteCount === 0
  // Bulk delete copy exhaustively covers preflight buckets before scope/rescan details append.
  const base = match({
    hasBaseTrashCopy,
    hasTrashRows,
    hasOrphanCleanupRows,
    hasOnlyOrphanRescan,
  })
    .with({ hasBaseTrashCopy: true }, () => {
      return `This moves the ${pluralize(totalCount, 'skill')} to the app trash and removes every symlink pointing to ${pluralize(totalCount, 'it', 'them')}. You can restore within 15 seconds from the notification.`
    })
    .with(
      { hasTrashRows: true, hasOrphanCleanupRows: false },
      () =>
        `This moves ${trashCount} ${pluralize(trashCount, 'skill')} to the app trash with a 15-second restore window.`,
    )
    .with(
      { hasTrashRows: false, hasOrphanCleanupRows: true },
      () =>
        `This removes reviewed dangling symlinks for ${orphanCleanupCount} orphan ${pluralize(orphanCleanupCount, 'skill')}. Source skill files are already missing, and this cleanup cannot be undone from the notification.`,
    )
    .with(
      { hasTrashRows: true, hasOrphanCleanupRows: true },
      () =>
        `This moves ${trashCount} ${pluralize(trashCount, 'skill')} to the app trash with a 15-second restore window and removes reviewed dangling symlinks for ${orphanCleanupCount} orphan ${pluralize(orphanCleanupCount, 'skill')}. Orphan cleanup cannot be undone from the notification.`,
    )
    .with(
      { hasOnlyOrphanRescan: true },
      () => 'No selected orphan skills are cleanup-ready.',
    )
    .with(
      {
        hasBaseTrashCopy: false,
        hasTrashRows: false,
        hasOrphanCleanupRows: false,
        hasOnlyOrphanRescan: false,
      },
      () => 'No selected skills are ready to delete.',
    )
    .exhaustive()

  const scopeSentences: string[] = []
  if (staleDeleteCount > 0) {
    scopeSentences.push(
      `${staleDeleteCount} selected ${pluralize(staleDeleteCount, 'skill')} ${pluralize(staleDeleteCount, 'needs', 'need')} a rescan before delete because the reviewed filesystem identity is missing.`,
    )
  }
  if (orphanRescanCount > 0) {
    scopeSentences.push(
      `${orphanRescanCount} orphan ${pluralize(orphanRescanCount, 'skill')} ${pluralize(orphanRescanCount, 'needs', 'need')} a rescan before cleanup because the reviewed target identity is missing.`,
    )
  }
  if (sourceSummary !== null) {
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
  }

  if (scopeSentences.length === 0) return base
  return `${base} ${scopeSentences.join(' ')}`
}
