import { Loader2, Undo2 } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'

import type {
  IsoTimestamp,
  SkillName,
  TombstoneId,
} from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { pluralize } from '../../utils/pluralize'

/** Tick interval for the countdown (ms). 250 gives smooth updates without thrashing. */
const COUNTDOWN_TICK_MS = 250
/** Seconds remaining at which the text transitions from muted to foreground. */
const URGENT_SECONDS_THRESHOLD = 5

interface UndoToastProps {
  /** sonner toast id — passed back so callbacks can `toast.dismiss(id)`. */
  toastId: string | number
  skillNames: SkillName[]
  /** Empty for unlink (no tombstones produced). */
  tombstoneIds: TombstoneId[]
  /** Absolute ISO time the undo window closes. */
  expiresAt: IsoTimestamp
  /** Pre-formatted summary line. */
  summary: string
  /** Callback when the user presses Undo. MainContent owns the dispatch. */
  onUndo: (tombstoneIds: TombstoneId[]) => Promise<void> | void
  /** Callback when the toast should dismiss itself (timer expired or closed). */
  onDismiss: () => void
}

/**
 * Body rendered inside `sonner.toast.custom(id => <UndoToast ... />)`.
 *
 * Two lines:
 *   1. Summary (e.g. "Deleted 3 skills. 7 symlinks removed.")
 *   2. Countdown + Undo button (e.g. "Undo · 12s")
 *
 * Behavior:
 *   - Tick every 250ms; display `Math.ceil(remainingMs / 1000)` so "15..1..0"
 *     reads linearly without snapping to the next integer early.
 *   - Swap text color from `text-muted-foreground` to `text-foreground` when
 *     `remainingMs <= URGENT_SECONDS_THRESHOLD * 1000`.
 *   - When the user clicks Undo: swap the button for a spinner + "Restoring N
 *     skills..." and await the onUndo promise. When it resolves, the parent
 *     emits a `toast.success` and this component is unmounted.
 *   - Keyboard: the wrapper is `tabIndex={-1}` so arrow-key focus cycles do
 *     not land on the toast (it is supplemental, not a required interaction).
 *     The Undo button itself is focusable.
 *
 * @param props - UndoToastProps — see interface above
 * @returns Rendered toast body
 * @example
 * toast.custom((id) => (
 *   <UndoToast toastId={id} skillNames={['task','theme']} ... />
 * ), { duration: 15_000 })
 */
export const UndoToast = React.memo(function UndoToast({
  toastId: _toastId,
  skillNames,
  tombstoneIds,
  expiresAt,
  summary,
  onUndo,
  onDismiss,
}: UndoToastProps): React.ReactElement {
  const expiresAtMs = new Date(expiresAt).getTime()
  const [remainingMs, setRemainingMs] = useState(
    Math.max(0, expiresAtMs - Date.now()),
  )
  const [isRestoring, setIsRestoring] = useState(false)
  const hasDismissedRef = useRef(false)

  // Keep onDismiss in a ref so the countdown effect below doesn't list it in
  // its deps. Parents often pass a fresh-identity callback on every render
  // (e.g. inline `() => dispatch(clearUndoToast())`), which would otherwise
  // tear down and restart `setInterval` every render — losing accumulated
  // ticks and making the countdown stutter.
  const onDismissRef = useRef(onDismiss)
  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    // Freeze the countdown once the user commits to Undo. Two reasons:
    //  1. Firing onDismiss() at the moment restore lands would unmount the
    //     toast mid-request, stranding the "Restoring N skills..." affordance.
    //  2. The success/error toast that follows is already owned by the parent.
    if (isRestoring) return
    // Tick while visible. No `prefers-reduced-motion` branch needed — we
    // aren't animating, just updating a number.
    const timer = setInterval(() => {
      const next = Math.max(0, expiresAtMs - Date.now())
      setRemainingMs(next)
      if (next === 0 && !hasDismissedRef.current) {
        hasDismissedRef.current = true
        onDismissRef.current()
      }
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

  const handleUndoClick = async (): Promise<void> => {
    if (!canUndo) return
    setIsRestoring(true)
    try {
      await onUndo(tombstoneIds)
    } finally {
      // Restoring finished — whether success or failure, the parent will emit
      // the appropriate sonner toast. We don't reset `isRestoring` because the
      // component will unmount immediately. Route through the ref so we match
      // the countdown-expiry branch and don't fire a stale closure after a
      // parent re-render.
      if (!hasDismissedRef.current) {
        hasDismissedRef.current = true
        onDismissRef.current()
      }
    }
  }

  return (
    <div
      tabIndex={-1}
      className="flex flex-col gap-2 w-full min-w-0"
      aria-live="polite"
    >
      <div className="text-sm font-medium truncate" title={summary}>
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
        {isUndoableOperation ? (
          <button
            type="button"
            onClick={handleUndoClick}
            disabled={!canUndo}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 min-h-[44px] text-sm font-medium',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
            aria-label={
              isRestoring
                ? `Restoring ${skillNames.length} ${pluralize(skillNames.length, 'skill')}`
                : `Undo delete of ${skillNames.length} ${pluralize(skillNames.length, 'skill')}`
            }
          >
            {isRestoring ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                Restoring {skillNames.length}{' '}
                {pluralize(skillNames.length, 'skill')}...
              </>
            ) : (
              <>
                <Undo2 className="h-4 w-4" />
                Undo
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  )
})
