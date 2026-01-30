import { createStorageMiddleware } from '@laststance/redux-storage-middleware'
import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { setupListeners } from '@reduxjs/toolkit/query'

import { listenerMiddleware } from './listener'
import agentsReducer from './slices/agentsSlice'
import skillsReducer from './slices/skillsSlice'
import themeReducer from './slices/themeSlice'
import uiReducer from './slices/uiSlice'

const rootReducer = combineReducers({
  theme: themeReducer,
  skills: skillsReducer,
  agents: agentsReducer,
  ui: uiReducer,
})

const {
  middleware: storageMiddleware,
  reducer,
  api,
} = createStorageMiddleware({
  rootReducer,
  key: 'skills-desktop-state',
  slices: ['theme'],
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
