import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'

const mockOpenExternal = vi.fn()
const mockSettingsOpen = vi.fn()

beforeEach(() => {
  mockOpenExternal.mockReset()
  mockOpenExternal.mockResolvedValue(undefined)
  mockSettingsOpen.mockReset()
  mockSettingsOpen.mockResolvedValue(undefined)
  // Browser mode replaces Electron's preload bridge, so install the shell and
  // settings IPC surfaces the footer's two affordances reach through.
  vi.stubGlobal('electron', {
    shell: {
      openExternal: mockOpenExternal,
    },
    settings: {
      open: mockSettingsOpen,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Render SidebarFooter inside the same TooltipProvider App.tsx wraps the tree
 * with, mirroring the production composition the gear tooltip depends on.
 * @returns The rendered browser screen.
 * @example
 * const { screen } = await renderFooter()
 */
async function renderFooter() {
  const { SidebarFooter } = await import('./SidebarFooter')
  const screen = await render(
    <TooltipProvider>
      <SidebarFooter />
    </TooltipProvider>,
  )
  return { screen }
}

describe('Sidebar → SidebarFooter', () => {
  it('opens the skills.sh marketplace in the default browser when the link is clicked', async () => {
    // Arrange
    const { screen } = await renderFooter()

    // Act
    await screen.getByRole('button', { name: /skills\.sh/i }).click()

    // Assert
    expect(mockOpenExternal).toHaveBeenCalledWith('https://skills.sh/')
  })

  it('opens the Settings window when the gear button is clicked', async () => {
    // Arrange
    const { screen } = await renderFooter()

    // Act
    await screen.getByRole('button', { name: 'Open settings' }).click()

    // Assert
    expect(mockSettingsOpen).toHaveBeenCalledTimes(1)
  })
})
