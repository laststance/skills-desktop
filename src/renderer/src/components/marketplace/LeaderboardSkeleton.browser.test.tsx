import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { LeaderboardSkeleton } from './LeaderboardSkeleton'

describe('LeaderboardSkeleton — leaderboard loading placeholder', () => {
  it('shows six placeholder rows so the loading state mirrors the leaderboard length', async () => {
    // Arrange + Act — this is what renders while the marketplace leaderboard is
    // still loading.
    const screen = await render(<LeaderboardSkeleton />)

    // Assert — exactly six skeleton rows are reserved (one per expected entry),
    // identified by the per-row `h-19` height class.
    const rows = screen.container.querySelectorAll('.h-19')
    expect(rows.length).toBe(6)
  })

  it('animates each placeholder so the rows read as loading rather than empty', async () => {
    // Arrange + Act
    const screen = await render(<LeaderboardSkeleton />)

    // Assert — every row contributes five pulsing placeholders (avatar, two text
    // lines, score, action), so the whole skeleton has 30 animated blocks.
    const pulsingBlocks = screen.container.querySelectorAll('.animate-pulse')
    expect(pulsingBlocks.length).toBe(30)
  })
})
