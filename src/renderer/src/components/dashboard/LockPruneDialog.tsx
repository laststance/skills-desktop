import { FileWarning, Loader2 } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'

import { DialogIconHeader } from '@/renderer/src/components/shared/dialog-icon-header'
import { Button } from '@/renderer/src/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from '@/renderer/src/components/ui/dialog'
import { ScrollArea } from '@/renderer/src/components/ui/scroll-area'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  fetchStaleLockEntries,
  pruneStaleLockEntries,
  selectConsentedLockEntryNames,
  selectIsPruningLockEntries,
  selectUnprunableLockEntries,
} from '@/renderer/src/redux/slices/skillLockSlice'
import {
  closeLockPruneDialog,
  selectLockPruneDialogOpen,
} from '@/renderer/src/redux/slices/uiSlice'
import { pluralize } from '@/renderer/src/utils/pluralize'
import type { PruneLockEntriesResult } from '@/shared/types'

import {
  describeLockPruneTarget,
  describeUnprunableReason,
  describeUnprunableSection,
} from './lockPruneCopy'

/**
 * Confirmation for removing skill-lock records whose skill is gone.
 *
 * Deliberately NOT folded into {@link SymlinkCleanupDialog}: that one validates
 * a `linkPath` and `targetPath` against each agent's base directory before
 * acting, and a stale lock record has neither. Reusing it would mean weakening
 * a path-validating pipeline to accept path-less items.
 *
 * One action, no per-item selection — every listed record points at a skill
 * that is already gone, so there is nothing to choose between.
 */
export const LockPruneDialog = function LockPruneDialog(): React.ReactElement {
  const dispatch = useAppDispatch()
  const isOpen = useAppSelector(selectLockPruneDialogOpen)
  // The list as it was when the dialog opened, not as it is now. A scan
  // landing mid-dialog would otherwise change what this button deletes after
  // the user already read the names.
  const consentedNames = useAppSelector(selectConsentedLockEntryNames)
  const isPruning = useAppSelector(selectIsPruningLockEntries)
  // Read live rather than snapshotted like `consentedNames`. That snapshot
  // exists because the confirm button ACTS on it; nothing acts on this list, so
  // freezing it would only let the dialog keep showing a reason a later scan
  // already cleared.
  const unprunableEntries = useAppSelector(selectUnprunableLockEntries)
  // Every count-dependent phrase comes from one call, so the sentence, the
  // pronoun and the button label cannot disagree about how many records there
  // are. Tested directly in `lockPruneCopy.test.ts`, without rendering.
  const copy = describeLockPruneTarget(consentedNames.length)
  // The dialog is reachable with nothing to remove: a user whose stale records
  // are ALL blocked still needs to reach the explanation. Without this the
  // whole body would read "0 skills" behind a "Remove 0 records" button.
  const hasRemovableRecords = consentedNames.length > 0

  const handleClose = (): void => {
    if (!isPruning) dispatch(closeLockPruneDialog())
  }

  const handlePrune = async (): Promise<void> => {
    let result: PruneLockEntriesResult
    try {
      result = await dispatch(pruneStaleLockEntries(consentedNames)).unwrap()
    } catch (error) {
      // A rejected thunk (IPC down, zod refusing an arg, main-process throw)
      // used to escape this handler unhandled: the dialog stayed open with no
      // toast and no re-scan, so the user got silence instead of a failure.
      dispatch(closeLockPruneDialog())
      toast.error(
        `Could not reach the skill lock: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }
    dispatch(closeLockPruneDialog())

    // Partial failure is expected to be rare but has to be visible: the records
    // that survived will show up in the widget again on the next scan.
    if (result.failed.length > 0) {
      toast.error(
        `Could not remove ${result.failed.length} of ${consentedNames.length} ${pluralize(consentedNames.length, 'record')}.`,
      )
    } else if (result.pruned.length === 0) {
      // Nothing failed, but nothing went either — main revalidated every name
      // and dropped it as a no-op. A success toast reading "Removed 0 records"
      // would claim work that never happened. The wording stays neutral because
      // `skipped` covers three different no-ops (already untracked, the skill
      // came back, still inside its undo window) and naming only one of them
      // would state something about disk we did not check.
      toast.info(
        `Kept ${result.skipped.length} ${pluralize(result.skipped.length, 'record')}: nothing stale left to remove.`,
      )
    } else {
      toast.success(
        `Removed ${result.pruned.length} stale ${pluralize(result.pruned.length, 'record')} from the skill lock.`,
      )
    }

    // Re-scan so the widget reflects disk, not our optimistic guess.
    void dispatch(fetchStaleLockEntries())
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      {/* The X is hidden rather than left to no-op: `handleClose` already
          refuses to close mid-prune, so a visible control that does nothing
          is the only thing the guard was still missing. */}
      <DialogContent className="max-w-md" hideCloseButton={isPruning}>
        <DialogHeader>
          <DialogIconHeader
            icon={FileWarning}
            tone="neutral"
            title="Prune skill lock"
          />
          <DialogDescription>
            {hasRemovableRecords ? (
              <>
                The skills CLI still tracks {copy.subject} no longer installed.
                Until the {copy.recordNoun} {copy.recordVerb} removed,{' '}
                <code className="text-xs">skills -g update</code> reinstalls{' '}
                {copy.pronoun}.
              </>
            ) : (
              <>
                Nothing here can be removed automatically. Until these records
                are sorted out,{' '}
                <code className="text-xs">skills -g update</code> keeps
                reinstalling the skills behind them.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {hasRemovableRecords ? (
          <ScrollArea className="max-h-48 rounded-md border border-border">
            <ul className="p-3 space-y-1 text-sm">
              {consentedNames.map((name) => (
                <li
                  key={name}
                  className="font-mono text-xs text-muted-foreground"
                >
                  {name}
                </li>
              ))}
            </ul>
          </ScrollArea>
        ) : null}

        {unprunableEntries.length > 0 ? (
          <section className="rounded-md border border-border bg-muted/40 p-3">
            <h3 className="text-xs font-medium text-foreground">
              {describeUnprunableSection(unprunableEntries.length)}
            </h3>
            {/* Capped like the removable list above: a lock can collide on
                many names at once, and two lines each would push the footer
                off screen. */}
            <ScrollArea className="mt-2 max-h-40">
              <ul className="space-y-2 pr-3">
                {unprunableEntries.map((entry) => (
                  <li key={entry.name} className="text-xs">
                    <span className="font-mono text-foreground">
                      {entry.name}
                    </span>
                    <p className="text-muted-foreground">
                      {describeUnprunableReason(entry.reason)}
                    </p>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </section>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPruning}>
            {/* Not "Close": that is already the corner X's accessible name, and
                two controls answering to it makes the footer ambiguous to a
                screen reader walking the dialog. */}
            {hasRemovableRecords ? 'Cancel' : 'Got it'}
          </Button>
          {hasRemovableRecords ? (
            <Button onClick={handlePrune} disabled={isPruning}>
              {isPruning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Pruning...
                </>
              ) : (
                copy.confirmLabel
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
