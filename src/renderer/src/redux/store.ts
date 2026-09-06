import { createStorageMiddleware } from '@laststance/redux-storage-middleware'
import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'
import { toast } from 'sonner'

import { PERSIST_STATE_VERSION, PERSIST_STORAGE_KEY } from '@/shared/constants'

import { listenerMiddleware } from './listener'
import { migrateState } from './migrations'
import { createReportingLocalStorage } from './reportingLocalStorage'
import activityReducer from './slices/activitySlice'
import agentsReducer from './slices/agentsSlice'
import bookmarkReducer from './slices/bookmarkSlice'
import dashboardReducer from './slices/dashboardSlice'
import marketplaceReducer from './slices/marketplaceSlice'
import protectReducer from './slices/protectSlice'
import settingsReducer from './slices/settingsSlice'
import skillLockReducer from './slices/skillLockSlice'
import skillsReducer from './slices/skillsSlice'
import themeReducer from './slices/themeSlice'
import uiReducer from './slices/uiSlice'
import updateReducer from './slices/updateSlice'
import widgetPickerReducer from './slices/widgetPickerSlice'

const rootReducer = combineReducers({
  theme: themeReducer,
  skills: skillsReducer,
  agents: agentsReducer,
  bookmarks: bookmarkReducer,
  protect: protectReducer,
  ui: uiReducer,
  update: updateReducer,
  marketplace: marketplaceReducer,
  dashboard: dashboardReducer,
  // Mirrors the skills CLI lock file on disk. Intentionally NOT persisted —
  // a cached stale count is wrong the moment a skill is deleted outside the app.
  skillLock: skillLockReducer,
  // Picker hover/focus preview state. Intentionally NOT persisted — last-hovered
  // widget shouldn't survive an app restart.
  widgetPicker: widgetPickerReducer,
  // Mirrors main-process settings.json. Intentionally NOT listed in
  // the redux-storage-middleware `slices` array — persistence is owned
  // by main, so layering localStorage here would create a dual-write race.
  // Both the Settings window (General → Default tab) and the main window
  // (SkillDetail tab buttons) read and write `defaultSkillTab` here.
  settings: settingsReducer,
  // Mirrors main-process activity-log.json (Activity Timeline widget).
  // Like `settings`, NOT in the redux-storage-middleware `slices` array —
  // persistence is owned by main, so localStorage here would dual-write.
  activity: activityReducer,
})

type RootReducerState = ReturnType<typeof rootReducer>

/**
 * Tell the user their persisted state is not reaching disk, once per app run.
 * Fires from {@link createReportingLocalStorage} when a save is rejected —
 * private mode, a disabled storage partition, or a full quota — because until
 * then the failure is a console line nobody reads. The copy names every
 * persisted slice, not just locks: `slices` below covers theme, bookmarks and
 * dashboard too, and all of them reset together.
 * @returns `true` once the toast has been published, so the adapter can latch; `false` while hydration is still running and nothing would be shown
 * @example warnPersistedStateNotSaved() // => true, and a non-expiring error toast
 */
function warnPersistedStateNotSaved(): boolean {
  // The one undebounced write is the persist-version migration inside
  // `rehydrate`, a microtask after this module evaluates — before React has
  // rendered the Toaster, where a published toast is dropped on the floor.
  // Reporting "not delivered" leaves the warning unspent for the next save,
  // which is debounced by 300ms and therefore always lands after mount.
  // Hydration that fails outright never flips this, but it also stops every
  // save (`saveHandler` is gated on the hydrated state), so nothing goes unreported.
  if (!storageApi.hasHydrated()) return false

  toast.error('Settings could not be saved', {
    description:
      'Locked skills, bookmarks and theme will reset when the app closes — local storage rejected the write.',
    // Non-expiring with an explicit close button: this is the one warning the
    // user gets, and a 4-second auto-dismiss can be missed entirely.
    duration: Infinity,
    closeButton: true,
  })
  return true
}

const {
  middleware: storageMiddleware,
  reducer,
  api: storageApi,
} = createStorageMiddleware<RootReducerState>({
  rootReducer,
  key: PERSIST_STORAGE_KEY,
  slices: ['theme', 'bookmarks', 'protect', 'dashboard'],
  version: PERSIST_STATE_VERSION,
  migrate: migrateState,
  // Replaces the library default, which console.errors a rejected write and
  // returns a silent no-op store when localStorage is unavailable.
  storage: createReportingLocalStorage(warnPersistedStateNotSaved),
})

export const store = configureStore({
  reducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .prepend(listenerMiddleware.middleware)
      .concat(storageMiddleware),
})

setupListeners(store.dispatch)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
export type AppStore = typeof store
