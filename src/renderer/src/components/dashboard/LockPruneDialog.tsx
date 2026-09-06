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
  selectIsPruningLockEntries,
  selectStaleLockEntryNames,
} from '@/renderer/src/redux/slices/skillLockSlice'
import {
  closeLockPruneDialog,
  selectLockPruneDialogOpen,
} from '@/renderer/src/redux/slices/uiSlice'
import { pluralize } from '@/renderer/src/utils/pluralize'

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
  const staleNames = useAppSelector(selectStaleLockEntryNames)
  const isPruning = useAppSelector(selectIsPruningLockEntries)

  const handleClose = (): void => {
    if (!isPruning) dispatch(closeLockPruneDialog())
  }

  const handlePrune = async (): Promise<void> => {
    const result = await dispatch(pruneStaleLockEntries(staleNames)).unwrap()
    dispatch(closeLockPruneDialog())

    // Partial failure is expected to be rare but has to be visible: the records
    // that survived will show up in the widget again on the next scan.
    if (result.failed.length > 0) {
      toast.error(
        `Could not remove ${result.failed.length} of ${staleNames.length} ${pluralize(staleNames.length, 'record')}.`,
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
          <DialogIconHeader icon={FileWarning} title="Clean skill lock" />
          <DialogDescription>
            The skills CLI still tracks{' '}
            {staleNames.length === 1
              ? 'a skill that is'
              : `${staleNames.length} skills that are`}{' '}
            no longer installed. Until the{' '}
            {pluralize(staleNames.length, 'record')}{' '}
            {staleNames.length === 1 ? 'is' : 'are'} removed,{' '}
            <code className="text-xs">skills -g update</code> reinstalls{' '}
            {staleNames.length === 1 ? 'it' : 'them'}.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-48 rounded-md border border-border">
          <ul className="p-3 space-y-1 text-sm">
            {staleNames.map((name) => (
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
                Cleaning...
              </>
            ) : (
              `Remove ${staleNames.length} ${pluralize(staleNames.length, 'record')}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
