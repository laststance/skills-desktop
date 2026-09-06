import { FileWarning, X } from 'lucide-react'
import React from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  dismissLockPruneBanner,
  selectLockPruneBannerDismissed,
} from '@/renderer/src/redux/slices/dashboardSlice'
import { selectStaleLockEntryCount } from '@/renderer/src/redux/slices/skillLockSlice'
import { openLockPruneDialog } from '@/renderer/src/redux/slices/uiSlice'
import { pluralize } from '@/renderer/src/utils/pluralize'

/**
 * One-time announcement that the app can now prune the skills CLI lock.
 *
 * Renders only when there is something to act on and the user has not
 * dismissed it. Dismissal is permanent (persisted in `dashboard`) because the
 * Symlink Health widget carries the recurring surface — the banner exists to
 * introduce the capability once, not to nag.
 */
export const LockPruneBanner =
  function LockPruneBanner(): React.ReactElement | null {
    const dispatch = useAppDispatch()
    const staleCount = useAppSelector(selectStaleLockEntryCount)
    const isDismissed = useAppSelector(selectLockPruneBannerDismissed)

    if (isDismissed || staleCount === 0) return null

    return (
      <div className="flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5">
        <FileWarning
          className="h-4 w-4 shrink-0 text-amber-400"
          aria-hidden="true"
        />
        <p className="flex-1 text-xs text-foreground">
          The skills CLI still tracks {staleCount} deleted{' '}
          {pluralize(staleCount, 'skill')}, so{' '}
          <code className="text-[11px]">skills -g update</code> brings{' '}
          {staleCount === 1 ? 'it' : 'them'} back. You can prune those records
          here now.
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => dispatch(openLockPruneDialog())}
          className="h-7 min-h-7 shrink-0 px-2 text-[11px]"
        >
          Prune lock
        </Button>
        <button
          type="button"
          onClick={() => dispatch(dismissLockPruneBanner())}
          aria-label="Dismiss skill lock announcement"
          className="min-h-7 min-w-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    )
  }
