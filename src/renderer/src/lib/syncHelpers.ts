import type { SyncPreviewResult } from '../../../shared/types'

/**
 * Whether to show the sync confirmation dialog (no-conflict case).
 * Returns true when there are new symlinks to create but no conflicts to resolve.
 * @param preview - Sync preview result from the main process, or null if not available
 * @returns true if the confirm dialog should be shown
 * @example
 * shouldShowSyncConfirm(null) // => false
 * shouldShowSyncConfirm({ toCreate: 5, conflicts: [] }) // => true
 * shouldShowSyncConfirm({ toCreate: 5, conflicts: [conflict] }) // => false (conflict dialog handles this)
 * shouldShowSyncConfirm({ toCreate: 0, conflicts: [] }) // => false (already synced)
 */
export function shouldShowSyncConfirm(
  preview: SyncPreviewResult | null,
): boolean {
  if (!preview) return false
  return preview.toCreate > 0 && preview.conflicts.length === 0
}
