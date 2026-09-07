import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import type { BackgroundSnapshot } from '@/shared/backgrounds'

let snapshot: BackgroundSnapshot = {
  revision: -1,
  displayRetryRevision: 0,
  operation: null,
  display: null,
}
const listeners = new Set<() => void>()
let stopListening: (() => void) | undefined

/** Adopts Main's latest revision once for both gallery and canvas, ignoring delayed acceptance snapshots.
 * @returns Nothing; subscribed React views and the shared Toaster receive current outcomes.
 * @example receiveSnapshot({ revision: 2, operation: null, display: null })
 */
function receiveSnapshot(next: BackgroundSnapshot): void {
  if (next.revision <= snapshot.revision) return
  const previousOperation = snapshot.operation
  snapshot = next
  const operation = next.operation
  // Display Retry changes its own revision; it must not replay the retained Apply outcome.
  const operationChanged =
    operation?.operationId !== previousOperation?.operationId ||
    operation?.status !== previousOperation?.status
  // A single toast ID replaces old outcomes; superseded work must never leave a failure visible.
  if (operationChanged && operation?.status === 'succeeded')
    toast.success('Background applied', {
      id: 'background-operation',
      description: operation.opacityAdjusted
        ? 'Background opacity was set to 60% for your first image.'
        : undefined,
    })
  else if (operationChanged && operation?.status === 'failed')
    toast.error('Background could not be applied', {
      id: 'background-operation',
      description: operation.error.message,
    })
  else if (operationChanged) toast.dismiss('background-operation')
  listeners.forEach((listener) => listener())
}

/** Subscribes before hydration so a slow snapshot cannot roll back a live operation result.
 * @returns Cleanup for this React subscriber; Main keeps accepted work when all views close.
 * @example subscribeBackground(() => renderLatest())
 */
function subscribeBackground(listener: () => void): () => void {
  listeners.add(listener)
  if (!stopListening) {
    stopListening = window.electron.backgrounds.onChanged(receiveSnapshot)
    void window.electron.backgrounds
      .getSnapshot()
      .then(receiveSnapshot)
      .catch(() =>
        toast.error('Background status unavailable', {
          description: 'Reopen Settings to try again.',
        }),
      )
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopListening?.()
      stopListening = undefined
      // A new renderer test or recreated bridge starts a fresh Main revision stream.
      snapshot = {
        revision: -1,
        displayRetryRevision: 0,
        operation: null,
        display: null,
      }
    }
  }
}

/** Reads the current Main-owned application/display state for Settings and the main canvas.
 * @returns Latest immutable operation and display snapshot.
 * @example const { operation, display } = useBackgroundSnapshot()
 */
export function useBackgroundSnapshot(): BackgroundSnapshot {
  return useSyncExternalStore(subscribeBackground, () => snapshot)
}

/** Refreshes the selected display through Main so Retry reaches both windows without a new Apply/provider call.
 * @returns Nothing after adopting the returned snapshot; later broadcasts still win by revision.
 * @example await retryBackgroundDisplay()
 */
export async function retryBackgroundDisplay(): Promise<void> {
  receiveSnapshot(await window.electron.backgrounds.retryDisplay())
}
