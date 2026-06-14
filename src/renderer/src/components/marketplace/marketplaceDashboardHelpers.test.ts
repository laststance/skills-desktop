import { describe, expect, it } from 'vitest'

import { resolveTrendingView } from '@/renderer/src/components/marketplace/marketplaceDashboardHelpers'

describe('resolveTrendingView', () => {
  it('shows the leaderboard rows whenever cached skills exist', () => {
    // Arrange / Act — five skills cached, fetch idle
    const view = resolveTrendingView(5, 'idle')

    // Assert
    expect(view).toBe('populated')
  })

  it('keeps showing cached rows during a background refresh instead of blanking to a skeleton', () => {
    // Arrange / Act — stale cache present while a refresh is in flight
    const view = resolveTrendingView(5, 'loading')

    // Assert — stale-while-revalidate: populated wins over loading
    expect(view).toBe('populated')
  })

  it('keeps showing cached rows even after a refresh fails', () => {
    // Arrange / Act — stale cache present but the latest fetch errored
    const view = resolveTrendingView(3, 'error')

    // Assert — populated wins over error so a failed refresh never blanks the list
    expect(view).toBe('populated')
  })

  it('shows the loading skeleton before any fetch has started', () => {
    // Arrange / Act — tab never visited yet (status undefined), no skills
    const view = resolveTrendingView(0, undefined)

    // Assert
    expect(view).toBe('loading')
  })

  it('shows the loading skeleton while the first fetch is in flight', () => {
    // Arrange / Act — fetch pending, nothing cached yet
    const view = resolveTrendingView(0, 'loading')

    // Assert
    expect(view).toBe('loading')
  })

  it('shows the offline error notice when the fetch fails with nothing cached', () => {
    // Arrange / Act — fetch failed and there is no stale data to fall back on
    const view = resolveTrendingView(0, 'error')

    // Assert
    expect(view).toBe('error')
  })

  it('shows the genuine empty state when the fetch succeeds with zero skills', () => {
    // Arrange / Act — fetch settled successfully but the leaderboard is empty
    const view = resolveTrendingView(0, 'idle')

    // Assert
    expect(view).toBe('empty')
  })
})
