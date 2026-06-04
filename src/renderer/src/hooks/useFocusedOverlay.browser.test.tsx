import { memo, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { useFocusedOverlay } from './useFocusedOverlay'

/**
 * Minimal host that surfaces the hook's state + actions as real DOM so the
 * suite drives it the way a user would (click to open/close, press Escape)
 * and asserts observable behavior rather than internal state.
 */
const OverlayHarness = memo(function OverlayHarness({
  resetKey,
}: {
  resetKey: string
}): ReactElement {
  const { isExpanded, expand, collapse, closeButtonRef } =
    useFocusedOverlay(resetKey)
  return (
    <div>
      <output data-testid="overlay-state">
        {isExpanded ? 'expanded' : 'collapsed'}
      </output>
      <button type="button" onClick={expand}>
        Open overlay
      </button>
      <button type="button" ref={closeButtonRef} onClick={collapse}>
        Close overlay
      </button>
    </div>
  )
})

beforeEach(() => {
  document.body.style.overflow = ''
})

afterEach(() => {
  // Guard against a test that asserts mid-expand leaking the scroll-lock.
  document.body.style.overflow = ''
})

describe('useFocusedOverlay', () => {
  it('enters the overlay and locks body scroll when expanded', async () => {
    // Arrange
    const screen = await render(<OverlayHarness resetKey="skill-a" />)

    // Act
    await screen.getByRole('button', { name: 'Open overlay' }).click()

    // Assert
    await expect
      .element(screen.getByTestId('overlay-state'))
      .toHaveTextContent('expanded')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('leaves the overlay and restores body scroll when collapsed', async () => {
    // Arrange
    const screen = await render(<OverlayHarness resetKey="skill-a" />)
    await screen.getByRole('button', { name: 'Open overlay' }).click()

    // Act
    await screen.getByRole('button', { name: 'Close overlay' }).click()

    // Assert
    await expect
      .element(screen.getByTestId('overlay-state'))
      .toHaveTextContent('collapsed')
    expect(document.body.style.overflow).toBe('')
  })

  it('collapses the overlay when the Escape key is pressed', async () => {
    // Arrange
    const screen = await render(<OverlayHarness resetKey="skill-a" />)
    await screen.getByRole('button', { name: 'Open overlay' }).click()
    await expect
      .element(screen.getByTestId('overlay-state'))
      .toHaveTextContent('expanded')

    // Act — a global Escape keydown while expanded.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    // Assert
    await expect
      .element(screen.getByTestId('overlay-state'))
      .toHaveTextContent('collapsed')
  })

  it('collapses an open overlay when the reset key changes (new subject)', async () => {
    // Arrange
    const screen = await render(<OverlayHarness resetKey="skill-a" />)
    await screen.getByRole('button', { name: 'Open overlay' }).click()
    await expect
      .element(screen.getByTestId('overlay-state'))
      .toHaveTextContent('expanded')

    // Act — switch to a different subject (e.g. previewing another skill).
    await screen.rerender(<OverlayHarness resetKey="skill-b" />)

    // Assert
    await expect
      .element(screen.getByTestId('overlay-state'))
      .toHaveTextContent('collapsed')
  })
})
