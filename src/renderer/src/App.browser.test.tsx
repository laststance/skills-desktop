import { configureStore } from '@reduxjs/toolkit'
import type React from 'react'
import { Provider } from 'react-redux'
import { describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'

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
 * @param settings - Appearance fields persisted in settings.
 * @returns Browser test screen for the rendered shell.
 * @example
 * renderAppWithSettings({ windowBackgroundOpacityPercent: 92 })
 */
async function renderAppWithSettings(settings: Partial<Settings>) {
  const { default: App } = await import('./App')
  const store = configureStore({
    reducer: {
      settings: settingsReducer,
      theme: themeReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS, ...settings },
    },
  })

  return render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
}

describe('App window surface', () => {
  test('leaves the native backplate visible while the Entire percentage is shared by all backgrounds', async () => {
    // Arrange
    const screen = await renderAppWithSettings({
      windowBackgroundOpacityPercent: 92,
      leftSectionOpacityPercent: 85,
    })
    // Act
    const surface = screen.getByTestId('window-background-surface').element()
    const sections = surface.querySelectorAll('[data-window-section]')
    // Assert
    expect(getComputedStyle(surface).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    expect(sections).toHaveLength(3)
    for (const section of sections) {
      expect(getComputedStyle(section).opacity).toBe('1')
      expect(
        getComputedStyle(section)
          .getPropertyValue('--window-surface-opacity')
          .trim(),
      ).toBe('0.92')
    }
  })

  test('changes each section background without fading descendant content', async () => {
    // Arrange
    const screen = await renderAppWithSettings({
      windowOpacityMode: 'section',
      windowBackgroundOpacityPercent: 92,
      leftSectionOpacityPercent: 85,
      centerSectionOpacityPercent: 90,
      rightSectionOpacityPercent: 95,
    })
    // Act
    const surface = screen.getByTestId('window-background-surface').element()
    // Assert
    for (const [name, expected] of [
      ['left', '0.85'],
      ['center', '0.9'],
      ['right', '0.95'],
    ]) {
      const section = surface.querySelector(`[data-window-section="${name}"]`)
      if (!section) throw new Error(`Missing ${name} pane`)
      expect(getComputedStyle(section).opacity).toBe('1')
      expect(
        getComputedStyle(section)
          .getPropertyValue('--window-surface-opacity')
          .trim(),
      ).toBe(expected)
      for (const child of section.querySelectorAll('*'))
        expect(getComputedStyle(child).opacity).toBe('1')
    }
  })
})
