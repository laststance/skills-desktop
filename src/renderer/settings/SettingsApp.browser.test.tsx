import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type { Agent } from '@/shared/types'

const mockSettingsGet = vi.fn()
const mockSettingsSet = vi.fn()
const mockSettingsOnChanged = vi.fn()
const mockSettingsUnsubscribe = vi.fn()
const mockCliCommandGetStatus = vi.fn()
const mockWindowGetMainBounds = vi.fn()
const mockAgentsGetAll = vi.fn()

/**
 * One installed agent is enough to keep the Agents pane's length-keyed
 * mount fetch idempotent while letting its rows render.
 */
const FIXTURE_AGENTS: Agent[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    path: '/Users/test/.claude/skills',
    exists: true,
    skillCount: 3,
    localSkillCount: 0,
  },
]

beforeEach(() => {
  mockSettingsGet.mockReset()
  mockSettingsGet.mockResolvedValue({ ...DEFAULT_SETTINGS })
  mockSettingsSet.mockReset()
  mockSettingsSet.mockResolvedValue(undefined)
  mockSettingsOnChanged.mockReset()
  mockSettingsUnsubscribe.mockReset()
  // `useSettingsSync` calls `unsubscribe()` on unmount — `onChanged` MUST
  // return a function or teardown throws `undefined is not a function`.
  mockSettingsOnChanged.mockReturnValue(mockSettingsUnsubscribe)
  mockCliCommandGetStatus.mockReset()
  mockCliCommandGetStatus.mockResolvedValue({
    status: 'not-installed',
    commandName: 'skills-desktop',
    commandPath: '/Users/test/.local/bin/skills-desktop',
    message: 'Command is not installed.',
  })
  mockWindowGetMainBounds.mockReset()
  mockWindowGetMainBounds.mockResolvedValue({ width: 1200, height: 800 })
  mockAgentsGetAll.mockReset()
  mockAgentsGetAll.mockResolvedValue(FIXTURE_AGENTS)
  // About reads the build-time `__APP_VERSION__` define to print "Version x".
  vi.stubGlobal('__APP_VERSION__', '0.21.1')
  // Browser mode has no preload bridge; install the union of every section's
  // IPC needs plus the About dev path (no `update` bridge → dev-disabled copy).
  vi.stubGlobal('electron', {
    settings: {
      get: mockSettingsGet,
      set: mockSettingsSet,
      onChanged: mockSettingsOnChanged,
    },
    cliCommand: { getStatus: mockCliCommandGetStatus },
    window: { getMainBounds: mockWindowGetMainBounds },
    agents: { getAll: mockAgentsGetAll },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Render the real SettingsApp with a store carrying every slice its panes
 * read, wrapped in TooltipProvider (Agents pane requirement).
 * @returns The vitest-browser render screen.
 * @example const screen = await renderSettings()
 */
async function renderSettings() {
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const store = configureStore({
    reducer: {
      settings: settingsReducer,
      agents: agentsReducer,
    },
    preloadedState: {
      settings: { ...DEFAULT_SETTINGS },
      agents: {
        items: FIXTURE_AGENTS,
        loading: false,
        error: null,
        agentToDelete: null,
        deleting: false,
      },
    },
  })
  const { SettingsApp } = await import('./SettingsApp')
  return render(
    <Provider store={store}>
      <TooltipProvider>
        <SettingsApp />
      </TooltipProvider>
    </Provider>,
  )
}

describe('Settings window navigation', () => {
  it('opens on the General pane with the full section nav rail', async () => {
    // Arrange / Act
    const screen = await renderSettings()

    // Assert — General is the default pane (its heading renders), and the
    // nav rail exposes every section as a button.
    await expect
      .element(screen.getByRole('heading', { name: 'General', level: 1 }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'General' }))
      .toHaveAttribute('aria-current', 'page')
    await expect
      .element(screen.getByRole('button', { name: 'Appearance' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Agents' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Keybindings' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'About' }))
      .toBeVisible()
  })

  it('shows the Appearance pane when its nav item is selected', async () => {
    // Arrange
    const screen = await renderSettings()

    // Act
    await screen.getByRole('button', { name: 'Appearance' }).click()

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'Appearance', level: 1 }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'Appearance' }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('shows the Agents pane when its nav item is selected', async () => {
    // Arrange
    const screen = await renderSettings()

    // Act
    await screen.getByRole('button', { name: 'Agents' }).click()

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'Agents', level: 1 }))
      .toBeVisible()
  })

  it('shows the Keybindings pane when its nav item is selected', async () => {
    // Arrange
    const screen = await renderSettings()

    // Act
    await screen.getByRole('button', { name: 'Keybindings' }).click()

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'Keybindings', level: 1 }))
      .toBeVisible()
  })

  it('shows the About pane when its nav item is selected', async () => {
    // Arrange
    const screen = await renderSettings()

    // Act
    await screen.getByRole('button', { name: 'About' }).click()

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'About', level: 1 }))
      .toBeVisible()
  })
})
