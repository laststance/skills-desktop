import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { store } from './redux/store'
import './styles/globals.css'

// Expose store globally for dev testing AND E2E assertions.
// `__E2E_BUILD__` is injected by `electron.vite.config.ts` and only true when
// the bundle was built with `E2E_BUILD=1`, so production users never see this.
// Usage in DevTools console:
//   window.__store.dispatch({ type: 'update/setAvailable', payload: { version: '0.2.0' } })
//   window.__store.dispatch({ type: 'update/setProgress', payload: { percent: 50 } })
//   window.__store.dispatch({ type: 'update/setReady', payload: { version: '0.2.0' } })
//   window.__store.dispatch({ type: 'update/reset' })
if (import.meta.env.DEV || __E2E_BUILD__) {
  // @ts-expect-error - intentionally exposing for dev/E2E testing
  window.__store = store
  // @ts-expect-error - alternate alias matching the E2E test plan's convention
  window.__store__ = store
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Provider store={store}>
        <App />
      </Provider>
    </ErrorBoundary>
  </StrictMode>,
)
