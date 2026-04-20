import { toast } from 'sonner'

import type { CliRemoveSkillsResult } from '../../../shared/types'

import { pluralize } from './pluralize'

/**
 * Per-item outcome summary for a CLI remove batch. Collapses the
 * success / partial / all-failed three-branch toast that was duplicated
 * between `DeleteCliSkillDialog` (confirm dialog path) and
 * `MainContent.handleConfirmBulk` (mixed bulk-delete path).
 *
 * @example
 * const result = await dispatch(cliRemoveSelectedSkills(names))
 * if (cliRemoveSelectedSkills.fulfilled.match(result)) {
 *   toastCliRemoveBatchResult(result.payload)
 * }
 */
export function toastCliRemoveBatchResult(result: CliRemoveSkillsResult): void {
  const total = result.items.length
  const removedItems = result.items.filter((i) => i.outcome === 'removed')
  const removed = removedItems.length
  const failed = total - removed

  if (failed === 0) {
    // Preserve the name-specific toast for the single-item path (the dialog
    // confirm flow dispatches a batch of length 1). Batch toasts that happen
    // to succeed with a single item are rare in practice but would also read
    // better with the name — so we key on length, not on caller.
    const title =
      removed === 1
        ? `Removed ${removedItems[0].skillName}`
        : `Removed ${removed} ${pluralize(removed, 'skill')}`
    toast.success(title, {
      description: 'Deregistered from ~/.agents/.skill-lock.json',
    })
    return
  }

  if (removed === 0) {
    // All-failed single-item case: surface the skill name and actual error
    // so the user sees what happened without digging through devtools.
    if (total === 1 && result.items[0].outcome === 'error') {
      const only = result.items[0]
      toast.error(`Failed to remove ${only.skillName}`, {
        description: only.error.message,
      })
      return
    }
    toast.error('Failed to remove skills', {
      description: `${failed} of ${total} failed`,
    })
    return
  }

  toast.warning(`Removed ${removed}, failed ${failed}`, {
    description: 'Some skills could not be deregistered',
  })
}
