import { useSyncExternalStore } from 'react'

/** Observes browser connectivity for recoverable gallery messages without triggering network requests.
 * @returns Current browser connectivity, updated by online/offline events.
 * @example const online = useOnlineStatus()
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine)
}

/** Shares native connectivity events with {@link useOnlineStatus} and removes them when its consumer closes.
 * @returns Listener cleanup for React's external-store subscription.
 * @example subscribe(refresh)
 */
function subscribe(notify: () => void): () => void {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
  return () => {
    window.removeEventListener('online', notify)
    window.removeEventListener('offline', notify)
  }
}
