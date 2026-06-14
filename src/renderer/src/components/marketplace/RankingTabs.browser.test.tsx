import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { RankingTabs } from './RankingTabs'

/**
 * Dispatch a real bubbling KeyboardEvent from inside the tablist so it reaches
 * RankingTabs' `onKeyDown` (React delegates synthetic events at the root, so the
 * event must bubble from the focused tab up through the tablist).
 * @param key - `KeyboardEvent.key` to fire (e.g. 'ArrowRight').
 * @param fromElement - The element the key is dispatched on (a focused tab).
 */
function pressKeyOn(key: string, fromElement: Element): void {
  fromElement.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true }),
  )
}

describe('RankingTabs — ranking filter selection', () => {
  it('renders the three leaderboard ranking tabs with the current filter selected', async () => {
    // Arrange + Act
    const screen = await render(
      <RankingTabs value="trending" onChange={vi.fn()} />,
    )

    // Assert — all three ranking choices are offered, and only the active one
    // is marked selected for assistive tech.
    await expect
      .element(screen.getByRole('tab', { name: 'All Time' }))
      .toHaveAttribute('aria-selected', 'false')
    await expect
      .element(screen.getByRole('tab', { name: 'Trending' }))
      .toHaveAttribute('aria-selected', 'true')
    await expect
      .element(screen.getByRole('tab', { name: 'Hot' }))
      .toHaveAttribute('aria-selected', 'false')
  })

  it('reports the chosen filter when a tab is clicked', async () => {
    // Arrange
    const handleChange = vi.fn()
    const screen = await render(
      <RankingTabs value="all-time" onChange={handleChange} />,
    )

    // Act
    await screen.getByRole('tab', { name: 'Hot' }).click()

    // Assert
    expect(handleChange).toHaveBeenCalledWith('hot')
  })

  it('advances to the next tab when the right arrow key is pressed', async () => {
    // Arrange
    const handleChange = vi.fn()
    const screen = await render(
      <RankingTabs value="all-time" onChange={handleChange} />,
    )
    const activeTab = screen.getByRole('tab', { name: 'All Time' }).element()

    // Act — right arrow moves selection from 'all-time' to 'trending'.
    pressKeyOn('ArrowRight', activeTab)

    // Assert
    expect(handleChange).toHaveBeenCalledWith('trending')
  })

  it('wraps to the first tab when the right arrow is pressed on the last tab', async () => {
    // Arrange
    const handleChange = vi.fn()
    const screen = await render(
      <RankingTabs value="hot" onChange={handleChange} />,
    )
    const activeTab = screen.getByRole('tab', { name: 'Hot' }).element()

    // Act — right arrow on the last tab ('hot') wraps to the first ('all-time').
    pressKeyOn('ArrowRight', activeTab)

    // Assert
    expect(handleChange).toHaveBeenCalledWith('all-time')
  })

  it('wraps to the last tab when the left arrow is pressed on the first tab', async () => {
    // Arrange
    const handleChange = vi.fn()
    const screen = await render(
      <RankingTabs value="all-time" onChange={handleChange} />,
    )
    const activeTab = screen.getByRole('tab', { name: 'All Time' }).element()

    // Act — left arrow on the first tab ('all-time') wraps to the last ('hot').
    pressKeyOn('ArrowLeft', activeTab)

    // Assert
    expect(handleChange).toHaveBeenCalledWith('hot')
  })

  it('ignores non-arrow keys so unrelated typing never changes the filter', async () => {
    // Arrange
    const handleChange = vi.fn()
    const screen = await render(
      <RankingTabs value="all-time" onChange={handleChange} />,
    )
    const activeTab = screen.getByRole('tab', { name: 'All Time' }).element()

    // Act — a key that is neither ArrowLeft nor ArrowRight.
    pressKeyOn('Enter', activeTab)

    // Assert
    expect(handleChange).not.toHaveBeenCalled()
  })

  it('does not respond to arrow keys while disabled during search', async () => {
    // Arrange
    const handleChange = vi.fn()
    const screen = await render(
      <RankingTabs value="all-time" onChange={handleChange} disabled={true} />,
    )
    const activeTab = screen.getByRole('tab', { name: 'All Time' }).element()

    // Act — arrow navigation is suppressed while the tabs are disabled.
    pressKeyOn('ArrowRight', activeTab)

    // Assert
    expect(handleChange).not.toHaveBeenCalled()
  })
})
