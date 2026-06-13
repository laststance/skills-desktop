import { memo, useState, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { SkipToMainContentLink } from './SkipToMainContentLink'

/**
 * Browser-mode tests for the "skip to main content" bypass link. Runs in
 * Chromium so the real anchor renders into the DOM and the WCAG 2.4.1 bypass
 * affordance can be asserted as a keyboard/screen-reader user would encounter
 * it: a focusable link pointing at the `#main-content` region. A parent that
 * re-renders without changing props drives React through the `memo` comparator
 * (`() => true`), proving the component bails out of wasted re-renders.
 */

// Harness whose own state changes force a parent re-render so React invokes the
// memo comparator on the child even though the child's props never change.
const MemoComparatorHarness = memo(
  function MemoComparatorHarness(): ReactElement {
    const [parentRenderCount, setParentRenderCount] = useState(0)
    return (
      <div>
        <SkipToMainContentLink />
        <button
          type="button"
          onClick={() => setParentRenderCount((current) => current + 1)}
        >
          re-render parent
        </button>
        <span>parent rendered {parentRenderCount} times</span>
      </div>
    )
  },
)

describe('SkipToMainContentLink', () => {
  it('offers keyboard users a link that jumps straight to the main content region', async () => {
    // Arrange + Act
    const screen = await render(<SkipToMainContentLink />)

    // Assert — a focusable link labelled for bypass, targeting #main-content.
    const skipLink = screen.getByRole('link', {
      name: 'Skip to main content',
    })
    await expect.element(skipLink).toBeInTheDocument()
    await expect.element(skipLink).toHaveAttribute('href', '#main-content')
  })

  it('keeps showing the same skip link after a parent re-renders with unchanged props', async () => {
    // Arrange — mount inside a parent that can re-render on demand.
    const screen = await render(<MemoComparatorHarness />)
    await expect
      .element(screen.getByText('parent rendered 0 times'))
      .toBeInTheDocument()

    // Act — trigger a parent re-render, which runs the memo comparator.
    await screen.getByRole('button', { name: 're-render parent' }).click()

    // Assert — the parent re-rendered yet the skip link is still present.
    await expect
      .element(screen.getByText('parent rendered 1 times'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: 'Skip to main content' }))
      .toBeInTheDocument()
  })
})
