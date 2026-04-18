import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { match } from 'ts-pattern'

import type {
  SyncExecuteResult,
  SyncPreviewResult,
} from '../../../shared/types'

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

/**
 * Whether to show the sync result dialog (per-item diff after sync execution).
 * Returns true when there is a sync result to display.
 * @param result - Sync execution result, or null if not available
 * @returns true if the result dialog should be shown
 * @example
 * shouldShowSyncResult(null) // => false
 * shouldShowSyncResult({ success: true, created: 3, ... }) // => true
 */
export function shouldShowSyncResult(
  result: SyncExecuteResult | null,
): boolean {
  return result !== null
}

/** Derived presentation fields for the sync result dialog header */
export interface SyncResultPresentation {
  HeaderIcon: LucideIcon
  iconColor: string
  description: string
}

/**
 * Compute the header icon, icon color, and summary description for a sync result.
 * Extracted as a pure function so it can be tested without rendering the dialog.
 * @param result - Sync execution result
 * @returns
 * - `HeaderIcon`: CheckCircle2 (all success) | AlertTriangle (partial) | XCircle (all errors)
 * - `iconColor`: Tailwind class matching the icon
 * - `description`: Human-readable summary (e.g. "Created 3 symlinks, 1 failed") or "No changes were made"
 * @example
 * getSyncResultPresentation({ created: 3, replaced: 0, skipped: 0, errors: [], ... })
 * // => { HeaderIcon: CheckCircle2, iconColor: 'text-emerald-500', description: 'Created 3 symlinks' }
 * @example
 * getSyncResultPresentation({ created: 0, replaced: 0, skipped: 0, errors: [{...}], ... })
 * // => { HeaderIcon: XCircle, iconColor: 'text-destructive', description: '1 failed' }
 */
export function getSyncResultPresentation(
  result: SyncExecuteResult,
): SyncResultPresentation {
  const hasErrors = result.errors.length > 0
  const hasSuccess = result.created > 0 || result.replaced > 0

  // Pair (hasErrors, hasSuccess) → 3 outcomes: all-success, partial, all-errors.
  // The { hasErrors: false } branches (with or without success) both land on
  // the success icon — matches the "No changes were made" summary when the
  // work set was empty. `.exhaustive()` locks all four boolean combinations at
  // compile time so a future refactor can't silently skip one.
  const { HeaderIcon, iconColor } = match({ hasErrors, hasSuccess })
    .with({ hasErrors: true, hasSuccess: true }, () => ({
      HeaderIcon: AlertTriangle,
      iconColor: 'text-amber-500',
    }))
    .with({ hasErrors: true, hasSuccess: false }, () => ({
      HeaderIcon: XCircle,
      iconColor: 'text-destructive',
    }))
    .with({ hasErrors: false }, () => ({
      HeaderIcon: CheckCircle2,
      iconColor: 'text-emerald-500',
    }))
    .exhaustive()

  const parts: string[] = []
  if (result.created > 0)
    parts.push(
      `Created ${result.created} symlink${result.created !== 1 ? 's' : ''}`,
    )
  if (result.replaced > 0)
    parts.push(
      `Replaced ${result.replaced} conflict${result.replaced !== 1 ? 's' : ''}`,
    )
  if (result.errors.length > 0) parts.push(`${result.errors.length} failed`)

  const description =
    parts.length > 0 ? parts.join(', ') : 'No changes were made'

  return { HeaderIcon, iconColor, description }
}
