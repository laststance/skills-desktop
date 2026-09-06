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
} from '@/renderer/src/redux/slices/skillLockSlice'
import {
  closeLockPruneDialog,
  selectLockPruneDialogOpen,
} from '@/renderer/src/redux/slices/uiSlice'
import { pluralize } from '@/renderer/src/utils/pluralize'
import type { PruneLockEntriesResult } from '@/shared/types'

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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogIconHeader
            icon={FileWarning}
            tone="neutral"
            title="Prune skill lock"
          />
          <DialogDescription>
            The skills CLI still tracks{' '}
            {consentedNames.length === 1
              ? 'a skill that is'
              : `${consentedNames.length} skills that are`}{' '}
            no longer installed. Until the{' '}
            {pluralize(consentedNames.length, 'record')}{' '}
            {consentedNames.length === 1 ? 'is' : 'are'} removed,{' '}
            <code className="text-xs">skills -g update</code> reinstalls{' '}
            {consentedNames.length === 1 ? 'it' : 'them'}.
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPruning}>
            Cancel
          </Button>
          <Button onClick={handlePrune} disabled={isPruning}>
            {isPruning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Pruning...
              </>
            ) : (
              `Remove ${consentedNames.length} ${pluralize(consentedNames.length, 'record')}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
