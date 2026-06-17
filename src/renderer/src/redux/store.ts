import { createStorageMiddleware } from '@laststance/redux-storage-middleware'
import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'

import { PERSIST_STATE_VERSION, PERSIST_STORAGE_KEY } from '@/shared/constants'

import { listenerMiddleware } from './listener'
import { migrateState } from './migrations'
import activityReducer from './slices/activitySlice'
import agentsReducer from './slices/agentsSlice'
import bookmarkReducer from './slices/bookmarkSlice'
import dashboardReducer from './slices/dashboardSlice'
import marketplaceReducer from './slices/marketplaceSlice'
import protectReducer from './slices/protectSlice'
import settingsReducer from './slices/settingsSlice'
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

const { middleware: storageMiddleware, reducer } =
  createStorageMiddleware<RootReducerState>({
    rootReducer,
    key: PERSIST_STORAGE_KEY,
    slices: ['theme', 'bookmarks', 'protect', 'dashboard'],
    version: PERSIST_STATE_VERSION,
    migrate: migrateState,
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
