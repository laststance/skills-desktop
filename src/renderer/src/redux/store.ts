import { createStorageMiddleware } from '@laststance/redux-storage-middleware'
import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'

import { listenerMiddleware } from './listener'
import agentsReducer from './slices/agentsSlice'
import bookmarkReducer from './slices/bookmarkSlice'
import dashboardReducer from './slices/dashboardSlice'
import marketplaceReducer from './slices/marketplaceSlice'
import skillsReducer from './slices/skillsSlice'
import themeReducer from './slices/themeSlice'
import uiReducer from './slices/uiSlice'
import updateReducer from './slices/updateSlice'

const rootReducer = combineReducers({
  theme: themeReducer,
  skills: skillsReducer,
  agents: agentsReducer,
  bookmarks: bookmarkReducer,
  ui: uiReducer,
  update: updateReducer,
  marketplace: marketplaceReducer,
  dashboard: dashboardReducer,
})

const {
  middleware: storageMiddleware,
  reducer,
  api,
} = createStorageMiddleware({
  rootReducer,
  key: 'skills-desktop-state',
  slices: ['theme', 'bookmarks', 'dashboard'],
})

export const store = configureStore({
  reducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .prepend(listenerMiddleware.middleware)
      .concat(storageMiddleware),
})

// Export hydration API for checking persistence status
export const persistApi = api

setupListeners(store.dispatch)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
