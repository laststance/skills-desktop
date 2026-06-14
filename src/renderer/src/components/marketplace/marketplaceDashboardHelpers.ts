import type { LeaderboardStatus } from '@/shared/types'

/** The four mutually-exclusive visual states the dashboard's Trending panel renders. */
export type TrendingView = 'populated' | 'loading' | 'error' | 'empty'

/**
 * Decide which Trending panel state the marketplace dashboard renders from the
 * cached skill count and fetch status. Extracted as a pure function so the
 * four-way visual branch is unit-testable without React Testing Library (per
 * the src/renderer `.coderabbit.yaml` guideline) and stays exhaustive.
 *
 * Precedence is stale-while-revalidate: any cached skills win first (so a
 * background refresh never blanks the list), then an in-flight/never-started
 * fetch shows the skeleton, then a failed fetch shows the offline notice, and
 * only a successful-but-empty result is treated as a genuine empty.
 *
 * @param trendingSkillCount - Number of trending skills available to render.
 * @param status - Cache fetch status for the trending filter, or `undefined` when never fetched.
 * @returns
 * - `'populated'` when at least one skill is present
 * - `'loading'` when no skills yet and the fetch is in flight (or never started)
 * - `'error'` when no skills and the last fetch failed
 * - `'empty'` when the fetch succeeded with zero skills
 * @example
 * resolveTrendingView(5, 'idle')    // => 'populated'
 * resolveTrendingView(0, undefined) // => 'loading'
 * resolveTrendingView(0, 'loading') // => 'loading'
 * resolveTrendingView(0, 'error')   // => 'error'
 * resolveTrendingView(0, 'idle')    // => 'empty'
 */
export function resolveTrendingView(
  trendingSkillCount: number,
  status: LeaderboardStatus | undefined,
): TrendingView {
  // Stale cache (even mid-refresh or after a failed refresh) always renders.
  if (trendingSkillCount > 0) return 'populated'
  // No data yet and a fetch is pending (or has never run) → skeleton, not "empty".
  if (status === undefined || status === 'loading') return 'loading'
  // Fetch finished but failed, with nothing cached to fall back on.
  if (status === 'error') return 'error'
  // Fetch succeeded with zero results — a true empty leaderboard.
  return 'empty'
}
