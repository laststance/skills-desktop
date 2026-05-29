import { configureStore } from '@reduxjs/toolkit'
import type React from 'react'
import { Provider } from 'react-redux'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import { DEFAULT_SETTINGS } from '@/shared/settings'

import settingsReducer from './redux/slices/settingsSlice'
import themeReducer from './redux/slices/themeSlice'

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: ({ className }: { className?: string }) => (
    <div className={className} />
  ),
}))

vi.mock('sonner', () => ({
  Toaster: () => null,
}))

vi.mock('./components/layout/DetailPanel', () => ({
  DetailPanel: () => <div data-testid="detail-panel" />,
}))

vi.mock('./components/layout/MainContent', () => ({
  MainContent: () => <main data-testid="main-content" />,
}))

vi.mock('./components/layout/Sidebar', () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}))

vi.mock('./components/UpdateToast', () => ({
  UpdateToast: () => null,
}))

vi.mock('./components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('./hooks/useReleaseNotesToast', () => ({
  useReleaseNotesToast: vi.fn(),
}))

vi.mock('./hooks/useSettingsSync', () => ({
  useSettingsSync: vi.fn(),
}))

vi.mock('./hooks/useUpdateNotification', () => ({
  useUpdateNotification: vi.fn(),
}))

/**
 * Render App with only the slices it reads directly. Heavy child panels are
 * mocked so this test can focus on the window-surface paint contract.
 * @param windowBackgroundBlurRadius - Slider value persisted in settings.
 * @returns Browser test screen for the rendered shell.
 * @example
 * renderAppWithBlur(24)
 */
async function renderAppWithBlur(windowBackgroundBlurRadius: number) {
  const { default: App } = await import('./App')
  const store = configureStore({
    reducer: {
      settings: settingsReducer,
      theme: themeReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS, windowBackgroundBlurRadius },
    },
  })

  return render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
}

describe('App window surface', () => {
  it('keeps the renderer surface solid while Electron owns opacity', async () => {
    // Arrange — render the shell with a non-zero blur radius persisted
    const screen = await renderAppWithBlur(24)

    // Act — read the painted window-background surface element
    const surface = screen
      .getByTestId('window-background-surface')
      .element() as HTMLElement

    // Assert — the renderer surface stays opaque and never flags translucency
    expect(surface.style.backgroundColor).toBe('var(--background)')
    expect(surface.dataset['windowTranslucent']).toBeUndefined()
  })
})
