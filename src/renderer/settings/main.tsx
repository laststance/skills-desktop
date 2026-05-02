import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import { ErrorBoundary } from '../src/components/ErrorBoundary'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { store } from '../src/redux/store'
import '../src/styles/globals.css'

import { SettingsApp } from './SettingsApp'

/**
 * Settings BrowserWindow entry. Loaded from `src/renderer/settings/index.html`,
 * which is registered as a second Rollup input in `electron.vite.config.ts`.
 *
 * Shares the main window's Redux store directly. The Settings UI only
 * touches the `settings` slice — every other slice (skills, agents,
 * ui, theme, etc.) is harmless ballast in this window: `useSettingsSync`
 * keeps `settings` aligned across windows via IPC, and the
 * redux-storage-middleware `slices` array (`theme | bookmarks | dashboard`)
 * intentionally excludes `settings`, so there's no dual-write race
 * with the main window even though both processes hold the same store
 * shape. Rationale: a single source of truth eliminates the slim-store
 * vs full-store divergence that previously required parallel selector
 * typing.
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
