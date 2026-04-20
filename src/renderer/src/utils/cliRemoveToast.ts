import { toast } from 'sonner'

import {
  CLI_REMOVE_BUSY_CODE,
  CLI_REMOVE_TIMEOUT_CODE,
  type CliRemoveSkillsResult,
} from '../../../shared/types'

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
  const cancelledItems = result.items.filter((i) => i.outcome === 'cancelled')
  const errorItems = result.items.filter((i) => i.outcome === 'error')
  const removed = removedItems.length
  const cancelled = cancelledItems.length
  const failed = errorItems.length
  const timeoutFailures = errorItems.filter(
    (item) => item.error.code === CLI_REMOVE_TIMEOUT_CODE,
  ).length
  const busyFailures = errorItems.filter(
    (item) => item.error.code === CLI_REMOVE_BUSY_CODE,
  ).length

  if (failed === 0 && cancelled === 0) {
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

  if (removed === 0 && cancelled > 0 && failed === 0) {
    toast.info(
      `Cancelled removing ${cancelled} ${pluralize(cancelled, 'skill')}`,
    )
    return
  }

  if (removed === 0 && failed > 0) {
    if (busyFailures === failed) {
      toast.error('CLI operation already running', {
        description: 'Another CLI operation is already in progress.',
      })
      return
    }

    if (timeoutFailures === failed) {
      toast.error('CLI remove timed out', {
        description: 'One or more CLI remove commands exceeded 60 seconds.',
      })
      return
    }

    // All-failed single-item case: surface the skill name and actual error
    // so the user sees what happened without digging through devtools.
    if (total === 1 && errorItems.length === 1) {
      const only = errorItems[0]
      const description =
        only.error.code === CLI_REMOVE_TIMEOUT_CODE
          ? 'CLI remove timed out. Please try again.'
          : only.error.code === CLI_REMOVE_BUSY_CODE
            ? 'Another CLI operation is already in progress.'
            : only.error.message
      toast.error(`Failed to remove ${only.skillName}`, {
        description,
      })
      return
    }
    toast.error('Failed to remove skills', {
      description: `${failed} of ${total} failed`,
    })
    return
  }

  if (removed > 0 && cancelled > 0 && failed === 0) {
    toast.warning(`Removed ${removed}, cancelled ${cancelled}`, {
      description: 'Batch was cancelled before all skills were processed',
    })
    return
  }

  if (removed === 0 && cancelled > 0 && failed > 0) {
    toast.warning(`Cancelled ${cancelled}, failed ${failed}`, {
      description: 'Some skills failed before cancellation completed',
    })
    return
  }

  if (removed > 0 && cancelled > 0 && failed > 0) {
    toast.warning(
      `Removed ${removed}, cancelled ${cancelled}, failed ${failed}`,
      {
        description: 'Batch completed with mixed outcomes',
      },
    )
    return
  }

  toast.warning(`Removed ${removed}, failed ${failed}`, {
    description: 'Some skills could not be deregistered',
  })
}
