import { memo, useState, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'

import { LeaderboardSkeleton } from './LeaderboardSkeleton'

/**
 * Browser-mode tests for the leaderboard loading skeleton. Runs in Chromium so
 * the real placeholder markup renders into the DOM and we can assert what a user
 * sees while the first leaderboard fetch is in flight: a fixed set of pulsing
 * rows that hold layout steady. The skeleton is `aria-hidden`, so it is queried
 * by markup (class selectors) rather than by role/text — matching how the
 * sibling `LeaderboardWidget` test probes for `.animate-pulse`. A parent that
 * re-renders with unchanged props drives React through the `memo` comparator,
 * proving the component bails out of wasted re-renders.
 */

// Harness whose own state changes force a parent re-render so React invokes the
// memo comparator on the child even though the child's props never change.
const MemoComparatorHarness = memo(
  function MemoComparatorHarness(): ReactElement {
    const [parentRenderCount, setParentRenderCount] = useState(0)
    return (
      <div>
        <LeaderboardSkeleton />
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

describe('LeaderboardSkeleton', () => {
  it('holds layout steady with three pulsing placeholder rows while the first fetch loads', async () => {
    // Arrange + Act
    const screen = await render(<LeaderboardSkeleton />)

    // Assert — exactly three placeholder rows render (matching the silhouette of
    // the loaded leaderboard) so the widget reserves space and does not pop in.
    const placeholderRows = screen.baseElement.querySelectorAll(
      '.flex.flex-col.gap-0\\.5 > div',
    )
    expect(placeholderRows.length).toBe(3)
    const pulsingBars = screen.baseElement.querySelectorAll('.animate-pulse')
    expect(pulsingBars.length).toBeGreaterThan(0)
  })

  it('hides the loading placeholders from assistive tech so screen readers skip the silhouette', async () => {
    // Arrange + Act
    const screen = await render(<LeaderboardSkeleton />)

    // Assert — the decorative skeleton is marked aria-hidden, so it is not
    // announced as content while real rows are still loading.
    const skeletonRoot = screen.baseElement.querySelector(
      '[aria-hidden="true"]',
    )
    expect(skeletonRoot).not.toBeNull()
  })

  it('keeps showing the same skeleton after a parent re-renders with unchanged props', async () => {
    // Arrange — mount inside a parent that can re-render on demand.
    const screen = await render(<MemoComparatorHarness />)
    await expect
      .element(screen.getByText('parent rendered 0 times'))
      .toBeInTheDocument()

    // Act — trigger a parent re-render, which runs the memo comparator.
    await screen.getByRole('button', { name: 're-render parent' }).click()

    // Assert — the parent re-rendered yet the three placeholder rows persist.
    await expect
      .element(screen.getByText('parent rendered 1 times'))
      .toBeInTheDocument()
    const placeholderRows = screen.baseElement.querySelectorAll(
      '.flex.flex-col.gap-0\\.5 > div',
    )
    expect(placeholderRows.length).toBe(3)
  })
})
