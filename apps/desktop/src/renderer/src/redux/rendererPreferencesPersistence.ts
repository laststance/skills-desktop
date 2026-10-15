import { createStorageMiddleware } from '@laststance/redux-storage-middleware'
import type { Middleware, Reducer } from '@reduxjs/toolkit'

import {
  MARKDOWN_PREVIEW_MODE_KEY,
  RELEASE_NOTES_LAST_SEEN_VERSION_KEY,
  RENDERER_PREFERENCES_STORAGE_KEY,
} from '@/shared/constants'

import { createReportingLocalStorage } from './reportingLocalStorage'
import {
  markReleaseNotesSeen,
  rendererPreferencesHydrated,
  setMarkdownPreviewMode,
  syncRendererPreferences,
  type RendererPreferencesState,
} from './slices/rendererPreferencesSlice'

type Preferences = Omit<RendererPreferencesState, 'hydrated'>

/** Validates untrusted storage before middleware hydration or a cross-window adoption.
 * @example normalizePreferences({ markdownPreviewMode: 'reading' })
 */
function normalizePreferences(value: unknown): Preferences {
  const candidate = typeof value === 'object' && value !== null ? value : {}
  return {
    markdownPreviewMode:
      'markdownPreviewMode' in candidate &&
      candidate.markdownPreviewMode === 'reading'
        ? 'reading'
        : 'code',
    lastSeenVersion:
      'lastSeenVersion' in candidate &&
      typeof candidate.lastSeenVersion === 'string' &&
      candidate.lastSeenVersion.length > 0
        ? candidate.lastSeenVersion
        : null,
  }
}

/** Reads only the dedicated middleware envelope; malformed events cannot reset a live choice.
 * @example parsePreferences('{"version":1,"state":{"rendererPreferences":{}}}')
 */
function parsePreferences(
  raw: string | null,
  strictFields = false,
): Preferences | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    // Unknown envelopes stay untouched so future formats are never mistaken for legacy data.
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('state' in parsed) ||
      typeof parsed.state !== 'object' ||
      parsed.state === null ||
      !('rendererPreferences' in parsed.state)
    ) {
      return null
    }
    const preferences = parsed.state.rendererPreferences
    if (
      typeof preferences !== 'object' ||
      preferences === null ||
      Array.isArray(preferences)
    )
      return null
    // Hydration rescues valid sibling fields; malformed notifications cannot reset a live choice.
    if (
      strictFields &&
      (('markdownPreviewMode' in preferences &&
        preferences.markdownPreviewMode !== 'code' &&
        preferences.markdownPreviewMode !== 'reading') ||
        ('lastSeenVersion' in preferences &&
          preferences.lastSeenVersion !== null &&
          typeof preferences.lastSeenVersion !== 'string'))
    )
      return null
    return normalizePreferences(preferences)
  } catch {
    return null
  }
}

/** Serializes only durable fields, excluding the runtime hydration flag.
 * @example serializePreferences({ markdownPreviewMode: 'code', lastSeenVersion: null })
 */
function serializePreferences(preferences: Preferences): string {
  return JSON.stringify({
    version: 1,
    state: { rendererPreferences: preferences },
  })
}

/**
 * Persists renderer choices through the installed storage middleware, independently of main-owned settings.
 * Called by store creation and isolated persistence tests. Local actions mark individual fields dirty;
 * delayed saves merge those fields with current disk values so a second window cannot undo another choice.
 * Legacy keys remain available for rollback and for a failed migration write.
 * @param rootReducer - Combined reducer containing the renderer preference slice.
 * @param reportWriteFailure - Existing user-facing save warning, latched only after delivery.
 * @example const persistence = createRendererPreferencesPersistence(rootReducer, reportFailure)
 */
export function createRendererPreferencesPersistence<
  S extends { rendererPreferences: RendererPreferencesState },
>(rootReducer: Reducer<S>, reportWriteFailure: (error: unknown) => boolean) {
  const dirty = new Set<keyof Preferences>()
  const edited = new Set<keyof Preferences>()
  let storeApi: Parameters<Middleware<object, S>>[0] | undefined
  let saved: Preferences | undefined
  let observed = normalizePreferences(null)
  let failureReported = false
  const reportFailure = (error: unknown): boolean => {
    if (!failureReported) failureReported = reportWriteFailure(error)
    return failureReported
  }
  const storage = createReportingLocalStorage(reportFailure, () => {
    // Clear only after a successful durable write; a quota failure must remain retryable.
    dirty.clear()
    edited.clear()
    if (saved) {
      observed = saved
      storeApi?.dispatch(syncRendererPreferences(saved))
    }
  })

  const persistence = createStorageMiddleware<S>({
    rootReducer,
    key: RENDERER_PREFERENCES_STORAGE_KEY,
    slices: ['rendererPreferences'],
    version: 1,
    storage: {
      getItem: (key) => {
        const raw = storage.getItem(key)
        if (raw !== null) {
          const preferences = parsePreferences(raw)
          observed = normalizePreferences(preferences)
          // Invalid dedicated storage uses defaults without deleting the original bytes.
          return serializePreferences(observed)
        }
        const legacyMode = storage.getItem(MARKDOWN_PREVIEW_MODE_KEY)
        const legacyVersion = storage.getItem(
          RELEASE_NOTES_LAST_SEEN_VERSION_KEY,
        )
        if (legacyMode === 'code' || legacyMode === 'reading')
          dirty.add('markdownPreviewMode')
        if (legacyVersion) dirty.add('lastSeenVersion')
        observed = normalizePreferences({
          markdownPreviewMode: legacyMode,
          lastSeenVersion: legacyVersion,
        })
        return serializePreferences(observed)
      },
      setItem: async (key) => {
        // The library saves on every Redux action; unchanged windows must never write stale choices.
        if (dirty.size === 0 || !storeApi) return
        // Serialize the full read/merge/write transaction across Chromium renderer processes.
        await navigator.locks.request(key, () => {
          if (dirty.size === 0 || !storeApi) return
          const persisted = parsePreferences(storage.getItem(key))
          const latest = persisted ?? observed
          const local = storeApi.getState().rendererPreferences
          saved = {
            // A queued legacy import yields to canonical values created by another window.
            markdownPreviewMode:
              dirty.has('markdownPreviewMode') &&
              (edited.has('markdownPreviewMode') || persisted === null)
                ? local.markdownPreviewMode
                : latest.markdownPreviewMode,
            lastSeenVersion:
              dirty.has('lastSeenVersion') &&
              (edited.has('lastSeenVersion') || persisted === null)
                ? local.lastSeenVersion
                : latest.lastSeenVersion,
          }
          storage.setItem(key, serializePreferences(saved))
        })
      },
      removeItem: storage.removeItem,
    },
    merge: (persisted, current) => ({
      ...current,
      rendererPreferences: {
        ...normalizePreferences(persisted.rendererPreferences),
        // Preserve any action made before asynchronous hydration settles.
        ...(edited.has('markdownPreviewMode')
          ? {
              markdownPreviewMode:
                current.rendererPreferences.markdownPreviewMode,
            }
          : {}),
        ...(edited.has('lastSeenVersion')
          ? { lastSeenVersion: current.rendererPreferences.lastSeenVersion }
          : {}),
        hydrated: false,
      },
    }),
    onHydrationComplete: () => {
      storeApi?.dispatch(rendererPreferencesHydrated())
    },
    onError: (error, operation) => {
      // Lock failures leave local edits pending, with the same visible warning as a failed write.
      if (operation === 'save') reportFailure(error)
    },
  })

  const middleware: Middleware<object, S> = (api) => {
    storeApi = api
    const bind = persistence.middleware(api)
    return (next) => {
      const handle = bind(next)
      return (action) => {
        if (setMarkdownPreviewMode.match(action)) {
          dirty.add('markdownPreviewMode')
          edited.add('markdownPreviewMode')
        }
        if (markReleaseNotesSeen.match(action)) {
          dirty.add('lastSeenVersion')
          edited.add('lastSeenVersion')
        }
        return handle(action)
      }
    }
  }

  /** Adopts storage changes for the entire store lifetime, including while no preview is mounted.
   * @example const dispose = persistence.subscribeToStorage(window)
   */
  function subscribeToStorage(target: Window): () => void {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== RENDERER_PREFERENCES_STORAGE_KEY)
        return
      if (
        event.storageArea !== null &&
        event.storageArea !== target.localStorage
      )
        return
      // Notifications are queued across processes: an older event must not undo a newer durable save.
      if (storage.getItem(RENDERER_PREFERENCES_STORAGE_KEY) !== event.newValue)
        return
      const preferences =
        event.newValue === null
          ? normalizePreferences(null)
          : parsePreferences(event.newValue, true)
      if (!preferences) return
      // Remote changes win for that field; unrelated unsaved local edits must survive.
      for (const field of ['markdownPreviewMode', 'lastSeenVersion'] as const) {
        if (event.newValue === null || preferences[field] !== observed[field])
          dirty.delete(field)
        edited.add(field)
      }
      observed = preferences
      const local = storeApi?.getState().rendererPreferences
      storeApi?.dispatch(
        syncRendererPreferences({
          markdownPreviewMode:
            dirty.has('markdownPreviewMode') && local
              ? local.markdownPreviewMode
              : preferences.markdownPreviewMode,
          lastSeenVersion:
            dirty.has('lastSeenVersion') && local
              ? local.lastSeenVersion
              : preferences.lastSeenVersion,
        }),
      )
    }
    target.addEventListener('storage', onStorage)
    return (): void => target.removeEventListener('storage', onStorage)
  }

  return { ...persistence, middleware, subscribeToStorage }
}
