import type { SyncStorage } from '@laststance/redux-storage-middleware'

/**
 * Wrap `localStorage` so a rejected persist write is reported once instead of vanishing.
 * Exists because the middleware's own adapter swallows every `setItem` throw
 * (`createSafeStorage`, `dist/index.mjs:147-155`) and degrades to a no-op store
 * when `localStorage` is unavailable, so a user whose locked skills, bookmarks
 * and theme have stopped persisting learns about it only after a restart.
 * Built once by the store and handed to `createStorageMiddleware`.
 * @param onWriteFailure - Called at most once per app run, on the first rejected write.
 * @returns A {@link SyncStorage} adapter that reads and removes exactly as leniently as the default one.
 * @example
 * createReportingLocalStorage(() => toast.error('Settings could not be saved'))
 */
export function createReportingLocalStorage(
  onWriteFailure: (error: unknown) => void,
): SyncStorage {
  // In-memory latch, deliberately not persisted: saves are debounced (300ms by
  // default) and repeat on every state change, so without it a broken
  // localStorage would fire one warning per edit for the whole session.
  let reported = false

  return {
    getItem: (key) => {
      try {
        return globalThis.localStorage.getItem(key)
      } catch {
        // Same degradation the default adapter already has: an unreadable
        // store is indistinguishable from an empty one and the app boots on
        // initialState. Not reported — nothing has been lost yet, and the next
        // write reports for real if storage is genuinely broken.
        return null
      }
    },
    setItem: (key, value) => {
      try {
        globalThis.localStorage.setItem(key, value)
      } catch (error) {
        // Private mode, a disabled storage partition and a quota overflow all
        // surface here as a throwing `setItem`, so the write path is the only
        // trigger needed. A construction-time availability probe would fire
        // before the Toaster subscribes and the warning would be dropped.
        console.error(
          '[redux] persisting app state to localStorage failed',
          error,
        )
        if (reported) return
        reported = true
        onWriteFailure(error)
      }
    },
    removeItem: (key) => {
      try {
        globalThis.localStorage.removeItem(key)
      } catch {
        // A failed remove leaves stale state behind, not lost state, so there
        // is nothing to warn the user about.
      }
    },
  }
}
