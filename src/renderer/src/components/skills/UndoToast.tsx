import { Loader2, Undo2 } from 'lucide-react'
import React, { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { match } from 'ts-pattern'

import { Button } from '@/renderer/src/components/ui/button'
import { useComponentEffect } from '@/renderer/src/hooks/useComponentEffect'
import { cn } from '@/renderer/src/lib/utils'
import { pluralize } from '@/renderer/src/utils/pluralize'
import type {
  IsoTimestamp,
  SkillName,
  ToastId,
  TombstoneId,
} from '@/shared/types'

/** Tick interval for the countdown (ms). 250 gives smooth updates without thrashing. */
const COUNTDOWN_TICK_MS = 250
/** Seconds remaining at which the text transitions from muted to foreground. */
const URGENT_SECONDS_THRESHOLD = 5

interface UndoToastProps {
  skillNames: SkillName[]
  /** Empty for unlink (no tombstones produced). */
  tombstoneIds: TombstoneId[]
  /** Absolute ISO time the undo window closes. */
  expiresAt: IsoTimestamp
  /** Pre-formatted summary line. */
  summary: string
  /** Callback when the user presses Undo. MainContent owns the dispatch. */
  onUndo: (tombstoneIds: TombstoneId[]) => Promise<void> | void
  /** Explicit Sonner id assigned by MainContent so Undo can dismiss itself. */
  toastId: ToastId
}

/**
 * Body rendered as the JSX content of `sonner.toast(<UndoToast ... />)`. Two
 * lines:
 *   1. Summary (e.g. "Deleted 3 skills. 7 symlinks removed.")
 *   2. Countdown + Undo button (e.g. "12s [Undo]")
 *
 * The toast must be rendered via sonner's default-styled wrapper (NOT
 * `toast.custom`) because sonner only injects its built-in close button on
 * styled toasts; `toast.custom` opts out of the styled wrapper.
 *
 * Behavior:
 *   - Tick every 250ms; display `Math.ceil(remainingMs / 1000)` so "15..1..0"
 *     reads linearly without snapping to the next integer early.
 *   - Swap text color from `text-muted-foreground` to `text-foreground` when
 *     `remainingMs <= URGENT_SECONDS_THRESHOLD * 1000`.
 *   - On Undo click: swap the button for a spinner + "Restoring N skills..."
 *     and await `onUndo`. Then fire `onUndoComplete` so the parent can dismiss
 *     the toast.
 *   - Keyboard: the wrapper is `tabIndex={-1}` so arrow-key focus cycles do
 *     not land on the toast body (it is supplemental, not a required
 *     interaction). The Undo button and sonner's close button remain focusable.
 *
 * @param props - UndoToastProps — see interface above
 * @returns Rendered toast body
 * @example
 * const toastId = toast(
 *   <UndoToast skillNames={['task','theme']} ... onUndoComplete={...} />,
 *   { duration: 15_000, closeButton: true, onDismiss, onAutoClose },
 * )
 */
export const UndoToast = React.memo(function UndoToast({
  skillNames,
  tombstoneIds,
  expiresAt,
  summary,
  onUndo,
  toastId,
}: UndoToastProps): React.ReactElement {
  const expiresAtMs = new Date(expiresAt).getTime()
  const [remainingMs, setRemainingMs] = useState(
    Math.max(0, expiresAtMs - Date.now()),
  )
  const [isRestoring, setIsRestoring] = useState(false)

  useComponentEffect(() => {
    // Freeze the countdown once the user commits to Undo so the displayed
    // "12s" doesn't keep ticking down behind a "Restoring..." spinner. The
    // parent dismisses the toast as soon as restore resolves, so the frozen
    // value is only ever briefly visible.
    if (isRestoring) return
    const timer = setInterval(() => {
      setRemainingMs(Math.max(0, expiresAtMs - Date.now()))
    }, COUNTDOWN_TICK_MS)
    return () => clearInterval(timer)
  }, [expiresAtMs, isRestoring])

  const remainingSeconds = Math.ceil(remainingMs / 1_000)
  const isUrgent = remainingSeconds <= URGENT_SECONDS_THRESHOLD
  // Unlink toasts are informational — they carry no tombstone ids because
  // nothing was moved to trash. We decide whether the Undo affordance should
  // even render here rather than relying on a visibly-disabled "dead" button.
  const isUndoableOperation = tombstoneIds.length > 0
  const canUndo = isUndoableOperation && !isRestoring && remainingMs > 0

  const handleUndoClick = useCallback(async (): Promise<void> => {
    if (!canUndo) return
    setIsRestoring(true)
    try {
      await onUndo(tombstoneIds)
    } finally {
      // Whether success or failure, the parent emits the appropriate sonner
      // toast and dismisses this one. We don't reset `isRestoring` because
      // the component will unmount immediately.
      toast.dismiss(toastId)
    }
  }, [canUndo, onUndo, toastId, tombstoneIds])

  return (
    <div
      tabIndex={-1}
      className="flex flex-col gap-2 min-w-0"
      aria-live="polite"
    >
      {/*
        `pl-7` reserves space for sonner's built-in × at top-left (8px from
        the edge + 20px wide). Without this, the close button would overlap
        the first character of the summary line.
      */}
      <div className="text-sm font-medium truncate pl-7" title={summary}>
        {summary}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            'text-xs tabular-nums transition-colors motion-reduce:transition-none',
            isUrgent ? 'text-foreground' : 'text-muted-foreground',
          )}
          aria-label={`${remainingSeconds} seconds remaining`}
        >
          {remainingSeconds}s
        </span>
        {match({ isUndoableOperation, isRestoring })
          .with({ isUndoableOperation: false }, () => null)
          .with({ isUndoableOperation: true, isRestoring: true }, () => (
            <Button
              size="sm"
              type="button"
              disabled
              className="shrink-0"
              aria-label={`Restoring ${skillNames.length} ${pluralize(skillNames.length, 'skill')}`}
            >
              <Loader2 className="animate-spin motion-reduce:animate-none" />
              Restoring {skillNames.length}{' '}
              {pluralize(skillNames.length, 'skill')}...
            </Button>
          ))
          .with({ isUndoableOperation: true, isRestoring: false }, () => (
            <Button
              size="sm"
              type="button"
              onClick={handleUndoClick}
              disabled={!canUndo}
              className="shrink-0"
              aria-label={`Undo delete of ${skillNames.length} ${pluralize(skillNames.length, 'skill')}`}
            >
              <Undo2 />
              Undo
            </Button>
          ))
          .exhaustive()}
      </div>
    </div>
  )
})
