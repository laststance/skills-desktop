import type { CliRemoveSkillsResult, SkillName } from '../../../shared/types'

import { toastCliRemoveBatchResult } from './cliRemoveToast'

/**
 * Name of the DOM CustomEvent fired when a per-row bulk operation fails.
 * `SkillItem` rows subscribe and flash a red left edge for 3s. Exported so
 * tests and listeners reference the same string (no stringly-typed drift).
 */
export const BULK_ITEM_FAILED_EVENT = 'skills:bulkItemFailed' as const

/**
 * Fire `skills:bulkItemFailed` for each failed row in a bulk op. The `SkillItem`
 * rows listen and flash a red left edge for 3s. Uses a DOM CustomEvent instead
 * of Redux state because the failure highlight is transient and per-row — piping
 * it through the store would cause a render cascade for a 3-second visual.
 *
 * @param failedNames - SkillNames that errored in the last batch
 * @example
 * flashFailedRows(failedNames)
 */
export const flashFailedRows = (failedNames: SkillName[]): void => {
  for (const skillName of failedNames) {
    window.dispatchEvent(
      new CustomEvent<{ skillName: SkillName }>(BULK_ITEM_FAILED_EVENT, {
        detail: { skillName },
      }),
    )
  }
}

/**
 * Shared settle handler for CLI remove batches. Flashes every failed row and
 * surfaces the aggregate summary toast in one call so both entry points
 * (`DeleteCliSkillDialog` confirm path and `MainContent.handleConfirmBulk`
 * mixed-delete path) give users identical visual + textual feedback.
 *
 * Without this, only the mixed-delete path flashed rows and the dialog path
 * went silent — so a user double-clicking "Remove" saw a toast but no
 * per-row hint about which skills actually failed.
 *
 * @param payload - CliRemoveSkillsResult from the fulfilled thunk
 * @example
 * if (cliRemoveSelectedSkills.fulfilled.match(result)) {
 *   settleCliRemoveBatch(result.payload)
 * }
 */
export const settleCliRemoveBatch = (payload: CliRemoveSkillsResult): void => {
  const failedNames = payload.items
    .filter((item) => item.outcome === 'error')
    .map((item) => item.skillName)
  flashFailedRows(failedNames)
  toastCliRemoveBatchResult(payload)
}
