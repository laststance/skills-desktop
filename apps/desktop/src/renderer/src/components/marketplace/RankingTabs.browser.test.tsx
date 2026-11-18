import { useState } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import type { RankingFilter } from '@/shared/types'

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
  test('renders the three leaderboard ranking tabs with the current filter selected', async () => {
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

  test('reports the chosen filter when a tab is clicked', async () => {
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

  test.each([
    {
      initial: 'all-time',
      from: 'All Time',
      arrow: 'ArrowRight',
      to: 'Trending',
    },
    { initial: 'hot', from: 'Hot', arrow: 'ArrowRight', to: 'All Time' },
    { initial: 'all-time', from: 'All Time', arrow: 'ArrowLeft', to: 'Hot' },
  ] as const)(
    '$arrow on $from keeps $to focused and selected after Enter',
    async ({ initial, from, arrow, to }) => {
      // Arrange
      function ControlledRankingTabs() {
        const [value, setValue] = useState<RankingFilter>(initial)
        return (
          <RankingTabs value={value} onChange={(filter) => setValue(filter)} />
        )
      }
      const screen = await render(<ControlledRankingTabs />)
      screen.getByRole('tab', { name: from }).element().focus()
      const destination = screen.getByRole('tab', { name: to })

      // Act
      await userEvent.keyboard(`{${arrow}}`)

      // Assert
      await expect.element(destination).toHaveFocus()
      await expect.element(destination).toHaveAttribute('aria-selected', 'true')
      await userEvent.keyboard('{Enter}')
      await expect.element(destination).toHaveFocus()
      await expect.element(destination).toHaveAttribute('aria-selected', 'true')
    },
  )

  test('ignores non-arrow keys so unrelated typing never changes the filter', async () => {
    // Arrange
    const handleChange = vi.fn()
    const screen = await render(
      <RankingTabs value="all-time" onChange={handleChange} />,
    )
    const activeTab = screen.getByRole('tab', { name: 'All Time' }).element()

    // Act — a key that is neither ArrowLeft nor ArrowRight.
    pressKeyOn('q', activeTab)

    // Assert
    expect(handleChange).not.toHaveBeenCalled()
  })

  test('does not respond to arrow keys while disabled during search', async () => {
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
