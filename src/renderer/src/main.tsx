import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import App from './App'
import { store } from './redux/store'
import './styles/globals.css'

// Expose store globally for development testing
// Usage in DevTools console:
//   window.__store.dispatch({ type: 'update/setAvailable', payload: { version: '0.2.0' } })
//   window.__store.dispatch({ type: 'update/setProgress', payload: { percent: 50 } })
//   window.__store.dispatch({ type: 'update/setReady', payload: { version: '0.2.0' } })
//   window.__store.dispatch({ type: 'update/reset' })
if (import.meta.env.DEV) {
  // @ts-expect-error - intentionally exposing for dev testing
  window.__store = store
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </StrictMode>,
)
