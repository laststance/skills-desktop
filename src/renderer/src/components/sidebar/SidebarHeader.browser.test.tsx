import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'

/**
 * Browser-mode tests for SidebarHeader. It embeds ThemeSelector (a Radix
 * DropdownMenu) which needs the theme Redux slice plus TooltipProvider, so the
 * harness mirrors the production composition App.tsx wraps the sidebar with.
 *
 * The header reads the build-time `__APP_VERSION__` define to render both the
 * "v<version>" label and its GitHub release-notes deep link, so each test stubs
 * that global before importing the component.
 */

beforeEach(() => {
  // Browser mode has no electron-vite `define`, so install the version the
  // header interpolates into the changelog link and the visible label.
  vi.stubGlobal('__APP_VERSION__', '0.21.1')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Render SidebarHeader inside the theme store + TooltipProvider its embedded
 * ThemeSelector depends on.
 * @returns The rendered browser screen.
 * @example
 * const { screen } = await renderHeader()
 */
async function renderHeader() {
  const { default: themeReducer } =
    await import('@/renderer/src/redux/slices/themeSlice')
  const store = configureStore({ reducer: { theme: themeReducer } })
  const { SidebarHeader } = await import('./SidebarHeader')
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <SidebarHeader />
      </TooltipProvider>
    </Provider>,
  )
  return { screen }
}

describe('Sidebar → SidebarHeader', () => {
  it('shows the Skills Desktop product title', async () => {
    // Arrange
    const { screen } = await renderHeader()

    // Act
    const title = screen.getByRole('heading', { name: 'Skills Desktop' })

    // Assert
    await expect.element(title).toBeInTheDocument()
  })

  it('labels the version link with the running build version', async () => {
    // Arrange
    const { screen } = await renderHeader()

    // Act
    const versionLink = screen.getByRole('link', { name: 'v0.21.1' })

    // Assert
    await expect.element(versionLink).toBeInTheDocument()
  })

  it('deep-links the version label to the matching GitHub release tag', async () => {
    // Arrange
    const { screen } = await renderHeader()

    // Act
    const versionLink = screen.getByRole('link', { name: 'v0.21.1' })

    // Assert — hard-coded so a drifted repo URL or tag scheme surfaces here.
    await expect
      .element(versionLink)
      .toHaveAttribute(
        'href',
        'https://github.com/laststance/skills-desktop/releases/tag/v0.21.1',
      )
  })

  it('opens the release notes in a new tab without leaking the opener', async () => {
    // Arrange
    const { screen } = await renderHeader()

    // Act
    const versionLink = screen.getByRole('link', { name: 'v0.21.1' })

    // Assert
    await expect.element(versionLink).toHaveAttribute('target', '_blank')
    await expect
      .element(versionLink)
      .toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('exposes the embedded theme selector trigger', async () => {
    // Arrange
    const { screen } = await renderHeader()

    // Act
    const trigger = screen.getByRole('button', {
      name: /Theme and color options/i,
    })

    // Assert
    await expect.element(trigger).toBeInTheDocument()
  })
})
