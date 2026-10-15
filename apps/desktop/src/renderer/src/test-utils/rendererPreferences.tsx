import { combineReducers, configureStore } from '@reduxjs/toolkit'
import type { ReactElement, ReactNode } from 'react'
import { Provider } from 'react-redux'
import { render as renderBrowser } from 'vitest-browser-react'

import { createRendererPreferencesPersistence } from '@/renderer/src/redux/rendererPreferencesPersistence'
import rendererPreferencesReducer from '@/renderer/src/redux/slices/rendererPreferencesSlice'
import settingsReducer from '@/renderer/src/redux/slices/settingsSlice'

/** Builds an isolated provider with the real middleware so component tests exercise loading and durable writes.
 * @example const fixture = await createPreferencesFixture()
 */
export async function createPreferencesFixture() {
  const persistence = createRendererPreferencesPersistence(
    combineReducers({
      rendererPreferences: rendererPreferencesReducer,
      settings: settingsReducer,
    }),
    () => true,
  )
  const store = configureStore({
    reducer: persistence.reducer,
    middleware: (defaults) => defaults().concat(persistence.middleware),
  })
  const unsubscribe = persistence.subscribeToStorage(window)
  await persistence.api.rehydrate()

  /** Keeps the provider stable across rerenders while sharing the current test's store.
   * @example await fixture.render(<FileContent content={content} />)
   */
  function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>
  }

  return {
    store,
    persistence,
    Wrapper,
    render: async (element: ReactElement) =>
      renderBrowser(element, { wrapper: Wrapper }),
    dispose: async (): Promise<void> => {
      unsubscribe()
      // Let the middleware's 300ms save settle before the next test clears storage.
      await new Promise((resolve) => setTimeout(resolve, 350))
    },
  }
}
