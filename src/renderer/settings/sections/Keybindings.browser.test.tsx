import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { Keybindings } from './Keybindings'

describe('Settings → Keybindings', () => {
  it('shows the pane heading and read-only description', async () => {
    // Arrange / Act
    const screen = await render(<Keybindings />)

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'Keybindings' }))
      .toBeVisible()
    await expect
      .element(
        screen.getByText(
          'Keyboard shortcuts wired into the app menu. Read-only for now.',
        ),
      )
      .toBeVisible()
  })

  it('lists every menu shortcut with its action label and glyph', async () => {
    // Arrange / Act
    const screen = await render(<Keybindings />)

    // Assert — each canonical menu accelerator surfaces its action + display.
    await expect.element(screen.getByText('Open settings')).toBeVisible()
    await expect.element(screen.getByText('⌘,')).toBeVisible()

    await expect.element(screen.getByText('Close window')).toBeVisible()
    await expect.element(screen.getByText('⌘W')).toBeVisible()

    await expect.element(screen.getByText('Minimize window')).toBeVisible()
    await expect.element(screen.getByText('⌘M')).toBeVisible()

    await expect.element(screen.getByText('Quit Skills Desktop')).toBeVisible()
    await expect.element(screen.getByText('⌘Q')).toBeVisible()

    await expect.element(screen.getByText('Reload')).toBeVisible()
    await expect.element(screen.getByText('⌘R')).toBeVisible()

    await expect.element(screen.getByText('Toggle full screen')).toBeVisible()
    await expect.element(screen.getByText('⌃⌘F')).toBeVisible()
  })

  it('renders one list row per defined shortcut', async () => {
    // Arrange / Act
    const screen = await render(<Keybindings />)

    // Assert — six canonical KEYBINDINGS map to six <li> rows.
    await expect
      .poll(() => screen.container.querySelectorAll('li').length)
      .toBe(6)
  })
})
