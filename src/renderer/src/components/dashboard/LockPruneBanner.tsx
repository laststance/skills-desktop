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

import { describeLockPruneTarget } from './lockPruneCopy'

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
    // Prunable records only, deliberately narrower than the widget's
    // `selectLockRecordsNeedingAttention`. Every sentence below promises a
    // prune, and blocked records cannot be pruned — announcing them here would
    // hand the user a button that can only tell them no. The widget is the
    // surface that reports those, and it says "Review lock" instead.
    const staleCount = useAppSelector(selectStaleLockEntryCount)
    // Same call the dialog makes, so the banner's subject clause and pronouns
    // cannot drift from the ones behind the button it opens.
    const copy = describeLockPruneTarget(staleCount)
    const isDismissed = useAppSelector(selectLockPruneBannerDismissed)

    if (isDismissed || staleCount === 0) return null

    return (
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2.5">
        <FileWarning
          className="h-4 w-4 shrink-0 text-foreground"
          aria-hidden="true"
        />
        <p className="flex-1 text-xs text-foreground">
          The skills CLI still tracks {copy.subject} you deleted, so{' '}
          <code className="text-[11px]">skills -g update</code> brings{' '}
          {copy.pronoun} back. You can prune {copy.pronoun} here now.
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
          className="min-h-7 min-w-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    )
  }
