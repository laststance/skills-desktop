import type { SyncStorage } from '@laststance/redux-storage-middleware'

/**
 * Wrap `localStorage` so a rejected persist write is reported once instead of vanishing.
 * Exists because the middleware's own adapter swallows every `setItem` throw
 * (`createSafeStorage`, `dist/index.mjs:147-155`) and degrades to a no-op store
 * when `localStorage` is unavailable, so a user whose locked skills, bookmarks
 * and theme have stopped persisting learns about it only after a restart.
 * Built once by the store and handed to `createStorageMiddleware`.
 * @param reportWriteFailure - Called on every rejected write until it returns `true`, i.e. until the warning actually reached the user.
 * @returns A {@link SyncStorage} adapter that reads and removes exactly as leniently as the default one.
 * @example
 * createReportingLocalStorage(() => { toast.error('Settings could not be saved'); return true })
 */
export function createReportingLocalStorage(
  reportWriteFailure: (error: unknown) => boolean,
): SyncStorage {
  // Latched on DELIVERY, not on failure, and deliberately not persisted. Saves
  // are debounced (300ms by default) and repeat on every state change, so a
  // per-failure latch would fire one warning per edit — but the middleware also
  // performs one UNDEBOUNCED write while hydrating (the persist-version
  // migration), long before React has mounted a toast surface. Spending the
  // latch there would swallow the only warning the user ever gets.
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
        // surface here — either as a throwing `setItem` or as a `localStorage`
        // that is not there to call — so the write path is the only trigger
        // needed. A construction-time availability probe would run before any
        // toast surface exists and the warning would be dropped.
        //
        // Logged on every rejection, unlike the user-facing warning: the
        // console line is the diagnostic trail, and matches what the library's
        // own adapter does today.
        console.error(
          '[redux] persisting app state to localStorage failed',
          error,
        )
        if (reported) return
        reported = reportWriteFailure(error)
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
