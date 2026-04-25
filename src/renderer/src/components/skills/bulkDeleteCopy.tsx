import type React from 'react'

import { pluralize } from '../../utils/pluralize'

/**
 * Render the DialogDescription body for the bulk-delete confirm dialog.
 *
 * Every skill — including ones tracked in `~/.agents/.skill-lock.json` — is
 * trashed via `moveToTrash` with a 15s undo window. The CLI removal branch
 * was removed; lock-file entries are not rewritten by the desktop app.
 *
 * Extracted out of the JSX so the dialog render stays readable and so the
 * copy stays testable without mounting the full MainContent tree.
 *
 * @param totalCount - Total skills in the pending batch
 * @returns React node to drop into `<DialogDescription>`
 * @example
 * <DialogDescription>
 *   {renderBulkDeleteDescription({ totalCount: 3 })}
 * </DialogDescription>
 */
export const renderBulkDeleteDescription = ({
  totalCount,
}: {
  totalCount: number
}): React.ReactNode => {
  return `This moves the ${pluralize(totalCount, 'skill')} to the app trash and removes every symlink pointing to ${pluralize(totalCount, 'it', 'them')}. You can restore within 15 seconds from the notification.`
}
