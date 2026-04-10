import { AlertTriangle, Loader2 } from 'lucide-react'
import React from 'react'

import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

interface DestructiveConfirmDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Called when the user closes the dialog (cancel / backdrop / escape) */
  onClose: () => void
  /** Called when the user confirms the destructive action */
  onConfirm: () => void
  /** Disables buttons and shows spinner while true */
  loading: boolean
  /** Dialog title text */
  title: string
  /** Description body — supports JSX for rich formatting */
  description: React.ReactNode
  /** Label for the confirm button (default: "Remove") */
  confirmLabel?: string
  /** Label shown while loading (default: "Removing...") */
  loadingLabel?: string
  /** AlertTriangle color variant (default: "destructive") */
  iconVariant?: 'destructive' | 'warning'
}

/**
 * Shared confirmation dialog for destructive actions.
 * Standardises the AlertTriangle + Cancel/Confirm pattern used across the app.
 * @example
 * <DestructiveConfirmDialog
 *   open={!!skillToDelete}
 *   onClose={handleClose}
 *   onConfirm={handleDelete}
 *   loading={deleting}
 *   title="Delete Skill"
 *   description={<>Permanently delete <strong>{name}</strong>?</>}
 *   confirmLabel="Delete"
 *   loadingLabel="Deleting..."
 * />
 */
export const DestructiveConfirmDialog = React.memo(
  function DestructiveConfirmDialog({
    open,
    onClose,
    onConfirm,
    loading,
    title,
    description,
    confirmLabel = 'Remove',
    loadingLabel = 'Removing...',
    iconVariant = 'destructive',
  }: DestructiveConfirmDialogProps): React.ReactElement {
    const iconColor =
      iconVariant === 'warning' ? 'text-amber-500' : 'text-destructive'

    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className={`h-5 w-5 ${iconColor}`} />
              <DialogTitle>{title}</DialogTitle>
            </div>
            <DialogDescription asChild>
              <div>{description}</div>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {loadingLabel}
                </>
              ) : (
                confirmLabel
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  },
)
