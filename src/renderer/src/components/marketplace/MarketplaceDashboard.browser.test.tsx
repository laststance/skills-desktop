import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import type { RootState } from '@/renderer/src/redux/store'
import type {
  BookmarkedSkill,
  HttpUrl,
  LeaderboardData,
  RankingFilter,
  RepositoryId,
  Skill,
  SkillName,
  SkillRank,
  SkillSearchResult,
} from '@/shared/types'

// MarketplaceDashboard is the right-pane summary shown when the Marketplace tab
// is active with no skill previewed. It reads three slices (installed count,
// bookmark count, trending leaderboard cache) and lets the user pick a trending
// row for preview. This file guards: the trending-row click → previewSkill
// selection, and the loading vs settled-empty trending placeholders.

/**
 * Build a `SkillSearchResult` fixture so each test varies only the field it
 * inspects.
 * @param overrides - Partial SkillSearchResult overrides
 */
function makeSearchResult(
  overrides: Partial<SkillSearchResult> = {},
): SkillSearchResult {
  return {
    rank: 1 as SkillRank,
    name: 'task' as SkillName,
    repo: 'vercel-labs/skills' as RepositoryId,
    url: 'https://skills.sh/task' as HttpUrl,
    installCount: undefined,
    ...overrides,
  }
}

/**
 * Build a `LeaderboardData` cache entry for the `trending` filter slot.
 * @param overrides - Partial LeaderboardData overrides (skills, status…)
 */
function makeLeaderboardData(
  overrides: Partial<LeaderboardData> = {},
): LeaderboardData {
  return {
    skills: [],
    lastFetched: Date.now(),
    filter: 'trending',
    status: 'idle',
    ...overrides,
  }
}

/**
 * Render MarketplaceDashboard over the real marketplace + skills + bookmark
 * reducers, seeded with `preloadedState`. The dashboard has no mount thunk, so
 * the seeded state is rendered verbatim with no async settling.
 * @param preloadedState - Partial marketplace + skills + bookmarks state to seed
 */
async function renderDashboard(preloadedState: {
  marketplace?: {
    leaderboard?: Partial<Record<RankingFilter, LeaderboardData>>
  }
  skills?: { items?: Skill[] }
  bookmarks?: { items?: BookmarkedSkill[] }
}) {
  const { default: marketplaceReducer } =
    await import('@/renderer/src/redux/slices/marketplaceSlice')
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: bookmarkReducer } =
    await import('@/renderer/src/redux/slices/bookmarkSlice')

  const store = configureStore({
    reducer: {
      marketplace: marketplaceReducer,
      skills: skillsReducer,
      bookmarks: bookmarkReducer,
    },
    preloadedState: {
      marketplace: {
        status: 'idle',
        searchQuery: '',
        searchResults: [],
        selectedSkill: null,
        previewSkill: null,
        installProgress: null,
        error: null,
        leaderboard: {},
        ...preloadedState.marketplace,
      } satisfies RootState['marketplace'],
      skills: {
        items: [],
        selectedSkill: null,
        loading: false,
        error: null,
        skillToUnlink: null,
        unlinking: false,
        skillToAddSymlinks: null,
        selectedAddAgentIds: [],
        addingSymlinks: false,
        skillToCopy: null,
        selectedCopyAgentIds: [],
        copying: false,
        selectedSkillNames: [],
        selectionAnchor: null,
        inFlightDeleteNames: [],
        inFlightUnlinkNames: [],
        bulkDeleting: false,
        bulkUnlinking: false,
        bulkCopying: false,
        bulkCopyModalOpen: false,
        bulkProgress: null,
        ...preloadedState.skills,
      } satisfies RootState['skills'],
      bookmarks: {
        items: [],
        ...preloadedState.bookmarks,
      } satisfies RootState['bookmarks'],
    },
  })

  const { MarketplaceDashboard } = await import('./MarketplaceDashboard')
  const screen = await render(
    <Provider store={store}>
      <MarketplaceDashboard />
    </Provider>,
  )
  return { screen, store }
}

describe('MarketplaceDashboard — trending preview selection', () => {
  it('selects a trending skill for preview when its row is clicked', async () => {
    // Arrange — one settled trending skill renders exactly one clickable row.
    const trendingSkill = makeSearchResult({
      rank: 1 as SkillRank,
      name: 'task' as SkillName,
      repo: 'vercel-labs/skills' as RepositoryId,
      url: 'https://skills.sh/task' as HttpUrl,
    })
    const { screen, store } = await renderDashboard({
      marketplace: {
        leaderboard: {
          trending: makeLeaderboardData({
            skills: [trendingSkill],
            status: 'idle',
            lastFetched: Date.now(),
          }),
        },
      },
    })

    // Act
    await screen.getByRole('button', { name: /task/ }).click()

    // Assert — the clicked skill is now the marketplace preview target.
    expect(store.getState().marketplace.previewSkill).toEqual({
      rank: 1,
      name: 'task',
      repo: 'vercel-labs/skills',
      url: 'https://skills.sh/task',
      installCount: undefined,
    })
  })
})

describe('MarketplaceDashboard — trending placeholders', () => {
  it('shows a loading placeholder while the trending leaderboard has not loaded yet', async () => {
    // Arrange — no trending cache entry means trendingData is undefined, which
    // the dashboard treats as still loading.
    const { screen } = await renderDashboard({
      marketplace: { leaderboard: {} },
    })

    // Act + Assert
    await expect
      .element(screen.getByText('Loading trending skills...'))
      .toBeInTheDocument()
  })

  it('shows a no-skills message when the trending leaderboard settled empty', async () => {
    // Arrange — a settled (idle) trending entry with zero skills is the empty
    // state, not the loading state.
    const { screen } = await renderDashboard({
      marketplace: {
        leaderboard: {
          trending: makeLeaderboardData({
            skills: [],
            status: 'idle',
            lastFetched: Date.now(),
          }),
        },
      },
    })

    // Act + Assert
    await expect
      .element(screen.getByText('No trending skills available'))
      .toBeInTheDocument()
  })
})
