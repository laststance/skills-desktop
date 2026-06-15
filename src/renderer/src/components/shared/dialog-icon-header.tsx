import type { LucideIcon } from 'lucide-react'
import React from 'react'

import { DialogTitle } from '@/renderer/src/components/ui/dialog'

/**
 * Tone variants for the leading icon. Matches the two distinct accents
 * the sync dialogs use today:
 * - `primary`: routine/positive flows (Sync, Cleanup).
 * - `amber`: warning flows (conflict resolution).
 */
type DialogIconHeaderTone = 'primary' | 'amber'

/**
 * Map of tone → text colour utility for the icon. Kept here so dialogs
 * cannot accidentally pair, say, an `AlertTriangle` with `text-primary`.
 */
const ICON_CLASS_BY_TONE: Record<DialogIconHeaderTone, string> = {
  primary: 'text-primary',
  amber: 'text-amber-500',
}

interface DialogIconHeaderProps {
  /** A `lucide-react` icon component (e.g. `Eraser`, `FolderSync`, `AlertTriangle`). */
  icon: LucideIcon
  /** Title text rendered inside `<DialogTitle>`. */
  title: React.ReactNode
  /** Icon accent colour. Defaults to `'primary'`. */
  tone?: DialogIconHeaderTone
}
/**
 * The icon + title pair that opens every sync-related dialog. Replaces
 * the inline `<div className="flex items-center gap-2"><Icon … /><DialogTitle>…</DialogTitle></div>`
 * markup that was duplicated across `SyncConfirmDialog`,
 * `SyncConflictDialog`, and `CleanupAgentDialog`. Render this as the
 * first child of `<DialogHeader>` (before `<DialogDescription>`).
 *
 * @example
 * <DialogHeader>
 *   <DialogIconHeader icon={Eraser} title="Cleanup missing skills" />
 *   <DialogDescription>…</DialogDescription>
 * </DialogHeader>
 * @example
 * <DialogIconHeader icon={AlertTriangle} title="Sync Conflicts" tone="amber" />
 */
export const DialogIconHeader = React.memo(function DialogIconHeader({
  icon: Icon,
  title,
  tone = 'primary',
}: DialogIconHeaderProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-5 w-5 ${ICON_CLASS_BY_TONE[tone]}`} />
      <DialogTitle>{title}</DialogTitle>
    </div>
  )
})
