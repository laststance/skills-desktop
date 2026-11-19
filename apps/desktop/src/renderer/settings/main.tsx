import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import { ErrorBoundary } from '@/renderer/src/components/ErrorBoundary'
import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { store } from '@/renderer/src/redux/store'
import '@/renderer/src/styles/globals.css'

import { SettingsApp } from './SettingsApp'

// Reuse the main renderer's E2E store seam for cross-process persistence assertions.
if (__E2E_BUILD__) {
  // @ts-expect-error - intentionally exposing the store only in E2E builds
  window.__store__ = store
}

/**
 * Settings BrowserWindow entry. Loaded from `src/renderer/settings/index.html`,
 * which is registered as a second Rollup input in `electron.vite.config.ts`.
 *
 * Each renderer owns a Redux store with the same selectors. Settings reads the
 * primary window's persisted theme and follows live theme broadcasts. It saves
 * native settings through IPC and shares preview preferences through their own
 * middleware. Only the primary window writes the bookmark collection.
 *
 * Provider chain order matters:
 *   StrictMode → ErrorBoundary → Provider → TooltipProvider → SettingsApp
 * Same shape as the main window's `main.tsx`. ErrorBoundary sits OUTSIDE
 * Provider so a render crash in any section still shows the recovery UI
 * with a working Reload button (the button calls `window.location.reload()`,
 * which doesn't depend on Redux).
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Provider store={store}>
        <TooltipProvider delayDuration={200}>
          <SettingsApp />
        </TooltipProvider>
      </Provider>
    </ErrorBoundary>
  </StrictMode>,
)
