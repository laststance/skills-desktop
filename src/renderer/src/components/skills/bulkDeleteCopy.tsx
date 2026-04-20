import React from 'react'

import { pluralize } from '../../utils/pluralize'

/**
 * Render the DialogDescription body for the bulk-delete confirm dialog.
 *
 * Three branches, driven by how many CLI-managed skills are in the batch:
 *  - `cliCount === 0`      → all-trash copy (reversible for 15s)
 *  - `cliCount === total`  → all-CLI copy (irreversible via `npx skills remove`)
 *  - otherwise             → mixed copy with per-bucket counts
 *
 * Extracted out of the JSX so the dialog render stays readable and so the
 * three-branch logic is testable without mounting the full MainContent tree.
 *
 * @param cliCount - CLI-managed skills in the pending batch (from `selectBulkCliCount`)
 * @param totalCount - Total skills in the pending batch
 * @returns React node to drop into `<DialogDescription>`
 * @example
 * <DialogDescription>
 *   {renderBulkDeleteDescription({ cliCount: 0, totalCount: 3 })}
 * </DialogDescription>
 */
export const renderBulkDeleteDescription = ({
  cliCount,
  totalCount,
}: {
  cliCount: number
  totalCount: number
}): React.ReactNode => {
  if (cliCount === 0) {
    return `This moves the ${pluralize(totalCount, 'skill')} to the app trash and removes every symlink pointing to ${pluralize(totalCount, 'it', 'them')}. You can restore within 15 seconds from the notification.`
  }

  if (cliCount === totalCount) {
    return (
      <>
        {pluralize(cliCount, 'This skill is', 'These skills are')} CLI-managed
        and will be deregistered via{' '}
        <code className="text-xs">npx skills remove</code>. This cannot be
        undone.
      </>
    )
  }

  const trashCount = totalCount - cliCount
  return (
    <>
      {trashCount} {pluralize(trashCount, 'skill')} will move to the app trash
      (restorable for 15s). <strong>{cliCount}</strong> CLI-managed{' '}
      {pluralize(cliCount, 'skill')} will run{' '}
      <code className="text-xs">npx skills remove</code> and cannot be undone.
    </>
  )
}
