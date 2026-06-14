import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { RootState } from '@/renderer/src/redux/store'
import type {
  HttpUrl,
  LeaderboardData,
  MarketplaceStatus,
  RankingFilter,
  RepositoryId,
  Skill,
  SkillName,
  SkillRank,
  SkillSearchResult,
} from '@/shared/types'

// SkillsMarketplace is the only screen that composes RankingTabs + search +
// leaderboard + results together. Nothing else renders it, so this file is the
// sole guard for: the "Updated X ago" relative-time label, the leaderboard
// empty/error/populated states, and the search results vs leaderboard switch.

beforeEach(() => {
  // Stub `electron` (not `window`) so the browser lane keeps its real
  // window/DOM. `useCycleEffect` dispatches `loadLeaderboard` on mount, which
  // reads `window.electron.marketplace.leaderboard`; provide a benign stub so
  // any thunk that the cache gate doesn't abort resolves to an empty list.
  vi.stubGlobal('electron', {
    skillsCli: {
      search: vi.fn(),
      install: vi.fn(),
      cancel: vi.fn(),
      onProgress: vi.fn(() => () => {}),
    },
    marketplace: {
      leaderboard: vi.fn(async () => []),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build a minimal `SkillSearchResult` fixture so each test varies only the
 * field under inspection.
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
 * Build a `LeaderboardData` cache entry for a single filter.
 * @param overrides - Partial LeaderboardData overrides (skills, lastFetched…)
 */
function makeLeaderboardData(
  overrides: Partial<LeaderboardData> = {},
): LeaderboardData {
  return {
    skills: [],
    lastFetched: Date.now(),
    filter: 'all-time',
    status: 'idle',
    ...overrides,
  }
}

/**
 * Render SkillsMarketplace over real marketplace + skills + bookmark reducers,
 * seeded with `preloadedState`. Driving state through `preloadedState` (instead
 * of dispatching async thunks) keeps each scenario deterministic — the mount
 * `loadLeaderboard` thunk's cache gate aborts when the seeded `all-time` entry
 * is fresh, so it never overwrites the seeded data.
 * @param preloadedState - Partial marketplace + skills state to seed
 */
async function renderMarketplace(preloadedState: {
  marketplace?: {
    status?: MarketplaceStatus
    searchQuery?: string
    searchResults?: SkillSearchResult[]
    error?: string | null
    leaderboard?: Partial<Record<RankingFilter, LeaderboardData>>
  }
  skills?: { items?: Skill[] }
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
    },
  })

  const { SkillsMarketplace } = await import('./SkillsMarketplace')
  const screen = await render(
    <Provider store={store}>
      <SkillsMarketplace />
    </Provider>,
  )
  return { screen, store }
}

describe('SkillsMarketplace — leaderboard view', () => {
  it('shows the pulsing skeleton while the leaderboard is loading with no skills yet', async () => {
    // Arrange
    const loadingLeaderboard = {
      'all-time': makeLeaderboardData({
        skills: [],
        lastFetched: 0,
        status: 'loading',
      }),
    }

    // Act
    await renderMarketplace({
      marketplace: { leaderboard: loadingLeaderboard },
    })

    // Assert — the busy region is marked busy and the 6-row pulsing skeleton
    // (and no error/empty state) is showing.
    await expect
      .poll(
        () =>
          document.querySelectorAll('[aria-busy="true"] .animate-pulse').length,
      )
      .toBeGreaterThan(0)
    expect(document.body.textContent).not.toContain('Leaderboard unavailable')
    expect(document.body.textContent).not.toContain('No skills found')
  })

  it('shows an offline message when the leaderboard fails to load', async () => {
    // Arrange — the seeded entry is errored, and the mount refetch also rejects,
    // so the error status survives the auto-load (its `condition` gate lets an
    // errored cache through, then `rejected` keeps the error state).
    const leaderboardStub = window.electron.marketplace.leaderboard
    if (vi.isMockFunction(leaderboardStub)) {
      leaderboardStub.mockRejectedValue(new Error('network down'))
    }
    const erroredLeaderboard = {
      'all-time': makeLeaderboardData({
        skills: [],
        lastFetched: 0,
        status: 'error',
        error: 'network down',
      }),
    }

    // Act
    const { screen } = await renderMarketplace({
      marketplace: { leaderboard: erroredLeaderboard },
    })

    // Assert
    await expect
      .element(screen.getByText('Leaderboard unavailable'))
      .toBeInTheDocument()
  })

  it('shows an empty-state when a settled leaderboard returns no skills', async () => {
    // Arrange — idle status, fetch completed (lastFetched > 0), zero skills.
    const emptyLeaderboard = {
      'all-time': makeLeaderboardData({
        skills: [],
        lastFetched: Date.now(),
        status: 'idle',
      }),
    }

    // Act
    const { screen } = await renderMarketplace({
      marketplace: { leaderboard: emptyLeaderboard },
    })

    // Assert
    await expect
      .element(screen.getByText('No skills found'))
      .toBeInTheDocument()
  })

  it('lists leaderboard skills with a single-skill count for one result', async () => {
    // Arrange — a single skill exercises the no-"s" singular count label.
    // `status: 'loading'` makes the mount refetch's `condition` gate abort, so
    // the seeded skills + lastFetched survive; with skills present the loading
    // UI does not show (it gates on an empty list).
    const oneSkillLeaderboard = {
      'all-time': makeLeaderboardData({
        skills: [makeSearchResult({ name: 'solo' as SkillName })],
        lastFetched: Date.now(),
        status: 'loading',
      }),
    }

    // Act
    const { screen } = await renderMarketplace({
      marketplace: { leaderboard: oneSkillLeaderboard },
    })

    // Assert — count line reads "1 skill · All Time" (singular, with FILTER_LABELS).
    await expect
      .element(screen.getByText(/1 skill\b.*All Time/))
      .toBeInTheDocument()
  })

  it('marks a leaderboard row as installed when its name is in the installed set', async () => {
    // Arrange — the skill name matches an installed skill, so the row shows the
    // Installed badge instead of an Install button.
    const installedSkill = {
      name: 'installed-one' as SkillName,
      description: 'desc',
      path: '/Users/me/.agents/skills/installed-one',
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      isOrphan: false,
    } as Skill
    // `status: 'loading'` aborts the mount refetch so the seeded skill survives.
    const leaderboardWithInstalled = {
      'all-time': makeLeaderboardData({
        skills: [makeSearchResult({ name: 'installed-one' as SkillName })],
        lastFetched: Date.now(),
        status: 'loading',
      }),
    }

    // Act
    const { screen } = await renderMarketplace({
      marketplace: { leaderboard: leaderboardWithInstalled },
      skills: { items: [installedSkill] },
    })

    // Assert — the installed badge (role=img) renders for the matched name.
    await expect
      .element(screen.getByRole('img', { name: /installed-one is installed/i }))
      .toBeInTheDocument()
  })
})

describe('SkillsMarketplace — "Updated X ago" relative-time label', () => {
  it('reads "just now" when the leaderboard was fetched seconds ago', async () => {
    // Arrange — 5 seconds ago → under one minute. `status: 'loading'` aborts the
    // mount refetch so the seeded lastFetched timestamp is the one rendered.
    const recentLeaderboard = {
      'all-time': makeLeaderboardData({
        skills: [makeSearchResult()],
        lastFetched: Date.now() - 5_000,
        status: 'loading',
      }),
    }

    // Act
    const { screen } = await renderMarketplace({
      marketplace: { leaderboard: recentLeaderboard },
    })

    // Assert
    await expect
      .element(screen.getByText('Updated just now'))
      .toBeInTheDocument()
  })

  it('reads "5 min ago" when the leaderboard was fetched five minutes ago', async () => {
    // Arrange — 5 minutes ago → minutes branch, under one hour. `status: 'loading'`
    // aborts the mount refetch so the seeded lastFetched timestamp is rendered.
    const fiveMinLeaderboard = {
      'all-time': makeLeaderboardData({
        skills: [makeSearchResult()],
        lastFetched: Date.now() - 5 * 60 * 1_000,
        status: 'loading',
      }),
    }

    // Act
    const { screen } = await renderMarketplace({
      marketplace: { leaderboard: fiveMinLeaderboard },
    })

    // Assert
    await expect
      .element(screen.getByText('Updated 5 min ago'))
      .toBeInTheDocument()
  })

  it('reads "3h ago" when the leaderboard was fetched three hours ago', async () => {
    // Arrange — 3 hours ago → hours branch. `status: 'loading'` aborts the mount
    // refetch (which would otherwise overwrite lastFetched, since 3h is past the
    // cache TTL) so the seeded 3h-old timestamp is the one rendered.
    const threeHourLeaderboard = {
      'all-time': makeLeaderboardData({
        skills: [makeSearchResult()],
        lastFetched: Date.now() - 3 * 60 * 60 * 1_000,
        status: 'loading',
      }),
    }

    // Act
    const { screen } = await renderMarketplace({
      marketplace: { leaderboard: threeHourLeaderboard },
    })

    // Assert
    await expect.element(screen.getByText('Updated 3h ago')).toBeInTheDocument()
  })
})

describe('SkillsMarketplace — search results view', () => {
  it('shows the searching spinner on the first search before any results land', async () => {
    // Arrange — committed query, status searching, no results yet.
    // Act
    const { screen } = await renderMarketplace({
      marketplace: {
        status: 'searching',
        searchQuery: 'react',
        searchResults: [],
      },
    })

    // Assert
    await expect.element(screen.getByText('Searching...')).toBeInTheDocument()
  })

  it('shows a no-results message naming the query when a search returns nothing', async () => {
    // Arrange — settled search (idle) with an empty result set.
    // Act
    const { screen } = await renderMarketplace({
      marketplace: {
        status: 'idle',
        searchQuery: 'nonexistent',
        searchResults: [],
      },
    })

    // Assert
    await expect
      .element(screen.getByText('No skills found for "nonexistent"'))
      .toBeInTheDocument()
  })

  it('lists each matching skill with a plural count when a search returns results', async () => {
    // Arrange — two results exercise the plural "skills" count label and the
    // search-results SkillRowMarketplace map.
    const results = [
      makeSearchResult({ rank: 1 as SkillRank, name: 'react' as SkillName }),
      makeSearchResult({
        rank: 2 as SkillRank,
        name: 'react-query' as SkillName,
      }),
    ]

    // Act
    const { screen } = await renderMarketplace({
      marketplace: {
        status: 'idle',
        searchQuery: 'react',
        searchResults: results,
      },
    })

    // Assert — header counts both results, and both rows render Install buttons.
    await expect
      .element(screen.getByText('Found 2 skills for "react"', { exact: false }))
      .toBeInTheDocument()
    const installButtons = screen.getByRole('button', { name: 'Install' }).all()
    expect(installButtons.length).toBe(2)
  })

  it('marks a search-result row as installed when its name is in the installed set', async () => {
    // Arrange — the result name matches an installed skill.
    const installedSkill = {
      name: 'react' as SkillName,
      description: 'desc',
      path: '/Users/me/.agents/skills/react',
      symlinkCount: 0,
      symlinks: [],
      isSource: true,
      isOrphan: false,
    } as Skill

    // Act
    const { screen } = await renderMarketplace({
      marketplace: {
        status: 'idle',
        searchQuery: 'react',
        searchResults: [makeSearchResult({ name: 'react' as SkillName })],
      },
      skills: { items: [installedSkill] },
    })

    // Assert
    await expect
      .element(screen.getByRole('img', { name: /react is installed/i }))
      .toBeInTheDocument()
  })
})

describe('SkillsMarketplace — ranking tab switch', () => {
  it('swaps the leaderboard to the chosen ranking when a tab is clicked', async () => {
    // Arrange — seed both the default (all-time) and the trending tab so each
    // tab's mount/switch refetch `condition` gate aborts (status: 'loading')
    // and the seeded skills survive. Trending carries a distinct skill name so
    // the assertion proves the view actually swapped.
    const bothTabsLeaderboard = {
      'all-time': makeLeaderboardData({
        skills: [makeSearchResult({ name: 'alltime-skill' as SkillName })],
        lastFetched: Date.now(),
        status: 'loading',
        filter: 'all-time',
      }),
      trending: makeLeaderboardData({
        skills: [makeSearchResult({ name: 'trending-skill' as SkillName })],
        lastFetched: Date.now(),
        status: 'loading',
        filter: 'trending',
      }),
    }
    const { screen } = await renderMarketplace({
      marketplace: { leaderboard: bothTabsLeaderboard },
    })
    // Sanity: the all-time tab content is showing first.
    await expect
      .element(screen.getByText(/1 skill\b.*All Time/))
      .toBeInTheDocument()

    // Act — click the Trending tab (interactive because no search is active).
    await screen.getByRole('tab', { name: 'Trending' }).click()

    // Assert — the count line now reflects the Trending filter label.
    await expect
      .element(screen.getByText(/1 skill\b.*Trending/))
      .toBeInTheDocument()
  })
})

describe('SkillsMarketplace — error banner', () => {
  it('surfaces a marketplace error message in a banner above the content', async () => {
    // Arrange
    // Act
    const { screen } = await renderMarketplace({
      marketplace: {
        status: 'error',
        error: 'Search failed',
      },
    })

    // Assert
    await expect.element(screen.getByText('Search failed')).toBeInTheDocument()
  })
})
