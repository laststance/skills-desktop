import { configureStore } from '@reduxjs/toolkit'
import type React from 'react'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import {
  DEFAULT_BACKGROUND_CROP,
  type BackgroundSelection,
  type BackgroundSnapshot,
} from '@/shared/backgrounds'
import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'

import settingsReducer, { setSettings } from './redux/slices/settingsSlice'
import themeReducer from './redux/slices/themeSlice'

const backgroundState = vi.hoisted(() => {
  const snapshot: BackgroundSnapshot = {
    revision: 0,
    displayRetryRevision: 0,
    operation: null,
    display: null,
  }
  return { snapshot }
})
beforeEach(() => {
  backgroundState.snapshot = {
    revision: 0,
    displayRetryRevision: 0,
    operation: null,
    display: null,
  }
})

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Separator: ({ className }: { className?: string }) => (
    <div className={className} />
  ),
}))

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('./components/layout/DetailPanel', () => ({
  DetailPanel: () => (
    <div data-testid="detail-panel">
      <input aria-label="Preview draft" defaultValue="Kept content" />
    </div>
  ),
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

vi.mock('./hooks/useBackgroundSnapshot', () => ({
  useBackgroundSnapshot: () => backgroundState.snapshot,
  retryBackgroundDisplay: vi.fn(),
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

  const screen = await render(
    <Provider store={store}>
      <App />
    </Provider>,
  )
  return { screen, store }
}

describe('App window surface', () => {
  test('adds a single image behind all panes without replacing their mounted content when layout or opacity changes', async () => {
    // Arrange
    const selected: BackgroundSelection = {
      source: { kind: 'builtin', builtinId: 'alpine-lake' },
      displayId: '00000000-0000-4000-8000-000000000001',
      crop: DEFAULT_BACKGROUND_CROP,
      aspect: 'original',
    }
    backgroundState.snapshot = {
      revision: 1,
      displayRetryRevision: 0,
      operation: null,
      display: {
        selection: selected,
        image: {
          url: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#345"/></svg>')}`,
          width: 1920,
          height: 1080,
        },
        crop: DEFAULT_BACKGROUND_CROP,
        title: 'Background image',
        credit: null,
      },
    }
    const { screen, store } = await renderAppWithSettings({
      background: {
        ...DEFAULT_SETTINGS.background,
        selected,
        hasAppliedImage: true,
      },
    })
    const surface = screen.getByTestId('window-background-surface').element()
    const sections = Array.from(
      surface.querySelectorAll('[data-window-section]'),
    )
    const detailContent = screen.getByTestId('detail-panel').element()
    const draft = screen.getByRole('textbox', { name: 'Preview draft' })
    await draft.fill('This mounted content must survive')
    // Act
    store.dispatch(
      setSettings({
        ...store.getState().settings,
        windowOpacityMode: 'section',
        leftSectionOpacityPercent: 30,
        centerSectionOpacityPercent: 60,
        rightSectionOpacityPercent: 85,
        background: { ...store.getState().settings.background, layout: 'tile' },
      }),
    )
    // Assert
    await expect
      .poll(() =>
        surface
          .querySelector('[data-background-image]')
          ?.getAttribute('data-background-layout'),
      )
      .toBe('tile')
    expect(screen.getByTestId('background-canvas').elements()).toHaveLength(1)
    expect(
      screen.getByTestId('background-canvas').element().parentElement,
    ).toBe(surface)
    expect(
      Array.from(surface.querySelectorAll('[data-window-section]')),
    ).toEqual(sections)
    expect(screen.getByTestId('detail-panel').element()).toBe(detailContent)
    await expect.element(draft).toHaveValue('This mounted content must survive')
    expect(getComputedStyle(detailContent).opacity).toBe('1')
    for (const section of sections) {
      expect(getComputedStyle(section).opacity).toBe('1')
      const foreground = section.firstElementChild
      if (!foreground)
        throw new Error('Every pane must retain its foreground content')
      expect(getComputedStyle(foreground).opacity).toBe('1')
    }
  })

  test('leaves the native backplate visible while the Entire percentage is shared by all backgrounds', async () => {
    // Arrange
    const { screen } = await renderAppWithSettings({
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
    const { screen } = await renderAppWithSettings({
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
