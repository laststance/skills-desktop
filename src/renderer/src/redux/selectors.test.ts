import { describe, expect, it } from 'vitest'

import { repositoryId } from '../../../shared/types'
import type {
  AgentId,
  BookmarkedSkill,
  RepositoryId,
  Skill,
  SkillName,
  SymlinkInfo,
} from '../../../shared/types'

import {
  selectBookmarksWithInstallStatus,
  selectFilteredSkills,
  selectHiddenSelectedCount,
  selectInFlightDeleteNamesSet,
  selectSelectedCount,
  selectSelectedSkillNamesSet,
  selectSelectedVisibleCount,
  selectSelectedVisibleNames,
  selectVisibleSkillNames,
} from './selectors'

/** Helper to build a minimal RootState for selector testing */
function buildState(overrides: {
  skills?: Skill[]
  searchQuery?: string
  searchScope?: 'name' | 'repo'
  selectedAgentId?: AgentId | null
  selectedSource?: RepositoryId | null
  sortOrder?: 'asc' | 'desc'
  skillTypeFilter?: 'all' | 'symlinked' | 'local'
  bookmarks?: BookmarkedSkill[]
  selectedSkillNames?: SkillName[]
  inFlightDeleteNames?: SkillName[]
  inFlightUnlinkNames?: SkillName[]
}) {
  return {
    skills: {
      items: overrides.skills ?? [],
      selectedSkill: null,
      loading: false,
      error: null,
      skillToUnlink: null,
      unlinking: false,
      skillToAddSymlinks: null,
      addingSymlinks: false,
      skillToCopy: null,
      copying: false,
      // v2.4 bulk-select state
      selectedSkillNames: overrides.selectedSkillNames ?? [],
      selectionAnchor: null,
      inFlightDeleteNames: overrides.inFlightDeleteNames ?? [],
      inFlightUnlinkNames: overrides.inFlightUnlinkNames ?? [],
      bulkDeleting: false,
      bulkUnlinking: false,
      bulkProgress: null,
    },
    ui: {
      activeTab: 'installed' as const,
      searchQuery: overrides.searchQuery ?? '',
      searchScope: overrides.searchScope ?? ('name' as const),
      selectedSource: overrides.selectedSource ?? null,
      sourceStats: null,
      isRefreshing: false,
      selectedAgentId: overrides.selectedAgentId ?? null,
      sortOrder: overrides.sortOrder ?? 'asc',
      skillTypeFilter: overrides.skillTypeFilter ?? 'all',
      isSyncing: false,
      syncPreview: null,
      syncResult: null,
      error: null,
      selectedBookmarkForDetail: null,
      undoToast: null,
    },
    // Other slices needed for RootState shape
    agents: {
      items: [],
      loading: false,
      error: null,
      agentToDelete: null,
      deleting: false,
    },
    update: {
      status: 'idle' as const,
      version: null,
      releaseNotes: null,
      progress: 0,
      error: null,
      dismissed: false,
    },
    theme: {
      hue: 0,
      chroma: 0,
      mode: 'dark' as const,
      preset: 'neutral-dark' as const,
    },
    marketplace: {
      status: 'idle' as const,
      searchQuery: '',
      searchResults: [],
      selectedSkill: null,
      installProgress: null,
      error: null,
    },
    bookmarks: {
      items: overrides.bookmarks ?? [],
    },
  }
}

/**
 * @param isLocal - false = symlinked source skill (default), true = agent-local-only
 *   folder. `isLocal=true` implies the skill exists only under `~/.<agent>/skills/`,
 *   never inside SOURCE_DIR, so `isSource` is forced to `false`.
 * @param source - Optional repo slug (`"owner/repo"`); when provided, sets
 *   both `source` and `sourceUrl` on the skill so repo-scope tests can assert
 *   on a real value. Omitted by default to mimic the most common state where
 *   skills lack source metadata.
 */
const makeSkill = (
  name: string,
  agentId: AgentId,
  isLocal = false,
  source?: string,
): Skill => ({
  name,
  description: `${name} skill`,
  path: isLocal
    ? `/home/user/.${agentId}/skills/${name}`
    : `/home/user/.agents/skills/${name}`,
  symlinkCount: isLocal ? 0 : 1,
  symlinks: [
    {
      agentId: agentId as SymlinkInfo['agentId'],
      agentName: agentId as SymlinkInfo['agentName'],
      linkPath: `/home/user/.${agentId}/skills/${name}`,
      targetPath: isLocal
        ? `/home/user/.${agentId}/skills/${name}`
        : `/home/user/.agents/skills/${name}`,
      status: 'valid',
      isLocal,
    },
  ],
  isSource: !isLocal,
  ...(source
    ? {
        source: repositoryId(source),
        sourceUrl: `https://github.com/${source}.git`,
      }
    : {}),
})

describe('selectFilteredSkills', () => {
  it('returns all source-dir skills when no agent is selected (SourceCard view)', () => {
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
    ]
    const state = buildState({ skills })
    expect(selectFilteredSkills(state as never)).toHaveLength(2)
  })

  it('hides agent-local-only skills from the SourceCard view (no agent selected)', () => {
    // Regression: clicking the SourceCard ("~/.agents/skills") used to leak
    // every claude-/cursor-local skill into the list because the selector
    // skipped filtering when selectedAgentId was null. Source-only filter
    // keeps the SourceCard view consistent with its label.
    const skills = [
      makeSkill('task', 'claude-code'), // source skill
      makeSkill('local-only', 'claude-code', true), // agent-local
    ]
    const state = buildState({ skills })
    const result = selectFilteredSkills(state as never)
    expect(result.map((s) => s.name)).toEqual(['task'])
  })

  it('filters by search query (name match)', () => {
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
    ]
    const state = buildState({ skills, searchQuery: 'task' })
    const result = selectFilteredSkills(state as never)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('task')
  })

  it('does not match description, only name', () => {
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
    ]
    const state = buildState({ skills, searchQuery: 'browse skill' })
    const result = selectFilteredSkills(state as never)
    expect(result).toHaveLength(0)
  })

  it('search is case-insensitive', () => {
    const skills = [makeSkill('Task', 'claude-code')]
    const state = buildState({ skills, searchQuery: 'TASK' })
    expect(selectFilteredSkills(state as never)).toHaveLength(1)
  })

  it('filters by selected agent', () => {
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
    ]
    const state = buildState({ skills, selectedAgentId: 'cursor' })
    const result = selectFilteredSkills(state as never)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('browse')
  })

  it('combines agent filter and search query', () => {
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
      makeSkill('code-review', 'cursor'),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      searchQuery: 'browse',
    })
    const result = selectFilteredSkills(state as never)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('browse')
  })

  it('excludes skills with broken symlinks for agent filter', () => {
    const skill: Skill = {
      name: 'broken-skill',
      description: 'broken',
      path: '/home/user/.agents/skills/broken-skill',
      symlinkCount: 1,
      symlinks: [
        {
          agentId: 'cursor' as SymlinkInfo['agentId'],
          agentName: 'Cursor' as SymlinkInfo['agentName'],
          linkPath: '/home/user/.cursor/skills/broken-skill',
          targetPath: '/home/user/.agents/skills/broken-skill',
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: true,
    }
    const state = buildState({ skills: [skill], selectedAgentId: 'cursor' })
    expect(selectFilteredSkills(state as never)).toHaveLength(0)
  })

  it('returns empty array when no skills match', () => {
    const skills = [makeSkill('task', 'claude-code')]
    const state = buildState({ skills, searchQuery: 'nonexistent' })
    expect(selectFilteredSkills(state as never)).toHaveLength(0)
  })

  it('sorts skills A→Z by default (asc)', () => {
    const skills = [
      makeSkill('zebra', 'claude-code'),
      makeSkill('alpha', 'claude-code'),
      makeSkill('middle', 'claude-code'),
    ]
    const state = buildState({ skills })
    const result = selectFilteredSkills(state as never)
    expect(result.map((s) => s.name)).toEqual(['alpha', 'middle', 'zebra'])
  })

  it('sorts skills Z→A when desc', () => {
    const skills = [
      makeSkill('alpha', 'claude-code'),
      makeSkill('zebra', 'claude-code'),
      makeSkill('middle', 'claude-code'),
    ]
    const state = buildState({ skills, sortOrder: 'desc' })
    const result = selectFilteredSkills(state as never)
    expect(result.map((s) => s.name)).toEqual(['zebra', 'middle', 'alpha'])
  })

  it('filters by skillTypeFilter=symlinked in agent view', () => {
    const skills = [
      makeSkill('linked-one', 'cursor'),
      makeSkill('local-one', 'cursor', true),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      skillTypeFilter: 'symlinked',
    })
    const result = selectFilteredSkills(state as never)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('linked-one')
  })

  it('filters by skillTypeFilter=local in agent view', () => {
    const skills = [
      makeSkill('linked-one', 'cursor'),
      makeSkill('local-one', 'cursor', true),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      skillTypeFilter: 'local',
    })
    const result = selectFilteredSkills(state as never)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('local-one')
  })

  it('returns empty when search + type filter combined exclude all', () => {
    const skills = [
      makeSkill('linked-one', 'cursor'),
      makeSkill('local-one', 'cursor', true),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      skillTypeFilter: 'local',
      searchQuery: 'linked',
    })
    const result = selectFilteredSkills(state as never)
    expect(result).toHaveLength(0)
  })

  it.each(['all', 'symlinked', 'local'] as const)(
    'skillTypeFilter=%s is ignored in SourceCard view (no agent selected)',
    (skillTypeFilter) => {
      // SourceCard view applies its own source-only filter, so skillTypeFilter
      // is moot here. `local-task` is hidden because it lives outside SOURCE_DIR,
      // not because of the symlinked/local filter.
      const skills = [
        makeSkill('task', 'claude-code'),
        makeSkill('local-task', 'cursor', true),
      ]
      const state = buildState({ skills, skillTypeFilter })
      const result = selectFilteredSkills(state as never)
      expect(result.map((s) => s.name)).toEqual(['task'])
    },
  )

  it('searchScope=repo matches against skill.source (repository slug)', () => {
    const skills = [
      makeSkill('task', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('browse', 'cursor', false, 'pbakaus/impeccable'),
      makeSkill('mcp', 'cursor', false, 'figma/mcp-server-guide'),
    ]
    const state = buildState({
      skills,
      searchQuery: 'figma',
      searchScope: 'repo',
    })
    const result = selectFilteredSkills(state as never)
    expect(result.map((s) => s.name)).toEqual(['mcp'])
  })

  it('searchScope=repo excludes Local skills (no source) even if name matches', () => {
    // Critical regression guard: in repo mode, a skill without `source` must
    // never appear, otherwise the result becomes inconsistent ("I searched a
    // repo and got a non-repo skill") and the toggle loses its meaning.
    const skills = [
      makeSkill('task', 'cursor'), // no source — Local-flavored
      makeSkill('task-from-repo', 'cursor', false, 'vercel-labs/skills'),
    ]
    const state = buildState({
      skills,
      searchQuery: 'task',
      searchScope: 'repo',
    })
    const result = selectFilteredSkills(state as never)
    expect(result.map((s) => s.name)).toEqual([])
  })

  it('selectedSource pill alone narrows to the matching repo with no query', () => {
    const skills = [
      makeSkill('a', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('b', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('c', 'claude-code', false, 'pbakaus/impeccable'),
    ]
    const state = buildState({
      skills,
      selectedSource: repositoryId('vercel-labs/skills'),
    })
    const result = selectFilteredSkills(state as never)
    expect(result.map((s) => s.name)).toEqual(['a', 'b'])
  })

  it('selectedSource pill stacks with searchScope=name + query', () => {
    // Scope is 'name' (default) — the pill narrows population to one repo,
    // then the name query narrows further within that population.
    const skills = [
      makeSkill('alpha', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('beta', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('alpha-other', 'claude-code', false, 'pbakaus/impeccable'),
    ]
    const state = buildState({
      skills,
      selectedSource: repositoryId('vercel-labs/skills'),
      searchQuery: 'alpha',
      searchScope: 'name',
    })
    const result = selectFilteredSkills(state as never)
    expect(result.map((s) => s.name)).toEqual(['alpha'])
  })

  it('selectedSource pill stacks with selectedAgentId (orthogonal filters)', () => {
    // Per Issue 4 decision: the source pill is independent of the agent pill.
    // Selecting an agent must not silently reset the pill, and the resulting
    // list intersects both filters.
    const skills = [
      makeSkill('a', 'cursor', false, 'vercel-labs/skills'),
      makeSkill('b', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('c', 'cursor', false, 'pbakaus/impeccable'),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSource: repositoryId('vercel-labs/skills'),
    })
    const result = selectFilteredSkills(state as never)
    expect(result.map((s) => s.name)).toEqual(['a'])
  })

  it('searchScope=name preserves the original name-match behavior', () => {
    // Regression guard: explicitly setting scope='name' must behave identically
    // to the pre-feature default so the toggle round-trips cleanly.
    const skills = [
      makeSkill('task', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('browse', 'cursor', false, 'vercel-labs/skills'),
    ]
    const state = buildState({
      skills,
      searchQuery: 'task',
      searchScope: 'name',
    })
    const result = selectFilteredSkills(state as never)
    expect(result.map((s) => s.name)).toEqual(['task'])
  })

  it('searchScope=repo with empty query does not exclude Local skills', () => {
    // The repo-scope filter only kicks in when there's a non-empty query.
    // An empty query in repo scope must still surface Local skills, because
    // the toggle is about what the query matches against, not a standalone
    // "show only repo skills" filter. Guards against a regression where the
    // scope itself was treated as a population filter.
    const skills = [
      makeSkill('local-task', 'cursor'),
      makeSkill('repo-task', 'cursor', false, 'vercel-labs/skills'),
    ]
    const state = buildState({
      skills,
      searchQuery: '',
      searchScope: 'repo',
    })
    const result = selectFilteredSkills(state as never)
    // Both surface — agent filter narrows to cursor, neither query nor
    // scope are doing any filtering work with an empty query.
    expect(result.map((s) => s.name)).toEqual(['local-task', 'repo-task'])
  })

  it('selectedSource pill stacks with searchScope=repo + matching query', () => {
    // Three-way compound: pill narrows to one repo, scope=repo searches
    // within source strings, query matches that source — confirms the
    // filters compose without short-circuiting each other (per Issue 4).
    const skills = [
      makeSkill('a', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('b', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('c', 'claude-code', false, 'pbakaus/impeccable'),
    ]
    const state = buildState({
      skills,
      selectedSource: repositoryId('vercel-labs/skills'),
      searchQuery: 'vercel',
      searchScope: 'repo',
    })
    const result = selectFilteredSkills(state as never)
    expect(result.map((s) => s.name)).toEqual(['a', 'b'])
  })

  it('selectedSource pill + searchScope=repo with non-matching query returns empty', () => {
    // Edge case: the pill says "in vercel-labs/skills" but the user types
    // 'figma' in repo scope. The compound filter must return empty — the
    // pill-narrowed population doesn't have a source matching 'figma',
    // so neither pill nor scope can produce a hit on its own.
    const skills = [
      makeSkill('a', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('b', 'claude-code', false, 'figma/mcp-server-guide'),
    ]
    const state = buildState({
      skills,
      selectedSource: repositoryId('vercel-labs/skills'),
      searchQuery: 'figma',
      searchScope: 'repo',
    })
    const result = selectFilteredSkills(state as never)
    expect(result.map((s) => s.name)).toEqual([])
  })

  it('is memoized (returns same reference for same inputs)', () => {
    const skills = [makeSkill('task', 'claude-code')]
    const state = buildState({ skills })
    const result1 = selectFilteredSkills(state as never)
    const result2 = selectFilteredSkills(state as never)
    expect(result1).toBe(result2)
  })
})

const makeBookmark = (name: string, repo: string): BookmarkedSkill => ({
  name,
  repo: repositoryId(repo),
  url: `https://skills.sh/${name}`,
  bookmarkedAt: '2026-04-01T00:00:00.000Z',
})

describe('selectBookmarksWithInstallStatus', () => {
  it('marks bookmarked skill as installed when name matches', () => {
    const state = buildState({
      skills: [makeSkill('task', 'claude-code')],
      bookmarks: [makeBookmark('task', 'vercel-labs/skills')],
    })
    const result = selectBookmarksWithInstallStatus(state as never)
    expect(result).toHaveLength(1)
    expect(result[0].isInstalled).toBe(true)
  })

  it('marks bookmarked skill as not installed when no match', () => {
    const state = buildState({
      skills: [makeSkill('browse', 'claude-code')],
      bookmarks: [makeBookmark('task', 'vercel-labs/skills')],
    })
    const result = selectBookmarksWithInstallStatus(state as never)
    expect(result).toHaveLength(1)
    expect(result[0].isInstalled).toBe(false)
  })

  it('returns empty array when no bookmarks', () => {
    const state = buildState({
      skills: [makeSkill('task', 'claude-code')],
      bookmarks: [],
    })
    expect(selectBookmarksWithInstallStatus(state as never)).toHaveLength(0)
  })

  it('is memoized (returns same reference for same inputs)', () => {
    const state = buildState({
      skills: [makeSkill('task', 'claude-code')],
      bookmarks: [makeBookmark('task', 'vercel-labs/skills')],
    })
    const result1 = selectBookmarksWithInstallStatus(state as never)
    const result2 = selectBookmarksWithInstallStatus(state as never)
    expect(result1).toBe(result2)
  })
})

describe('selectVisibleSkillNames', () => {
  it('projects selectFilteredSkills into an ordered name array', () => {
    const skills = [
      makeSkill('zebra', 'claude-code'),
      makeSkill('alpha', 'claude-code'),
    ]
    const state = buildState({ skills })
    expect(selectVisibleSkillNames(state as never)).toEqual(['alpha', 'zebra'])
  })

  it('returns [] when the filter produces no rows', () => {
    const skills = [makeSkill('task', 'claude-code')]
    const state = buildState({ skills, searchQuery: 'unmatched' })
    expect(selectVisibleSkillNames(state as never)).toEqual([])
  })
})

describe('selectSelectedCount', () => {
  it('returns 0 when nothing is ticked', () => {
    const state = buildState({})
    expect(selectSelectedCount(state as never)).toBe(0)
  })

  it('returns the array length regardless of visibility', () => {
    const state = buildState({
      selectedSkillNames: ['a', 'b', 'c'],
    })
    expect(selectSelectedCount(state as never)).toBe(3)
  })
})

describe('selectSelectedVisibleNames', () => {
  it('intersects selected names with the visible list, preserving visible order', () => {
    const skills = [
      makeSkill('alpha', 'claude-code'),
      makeSkill('browser', 'claude-code'),
      makeSkill('task', 'claude-code'),
    ]
    const state = buildState({
      skills,
      selectedSkillNames: ['task', 'alpha', 'ghost'],
    })
    // visible order is alphabetical: alpha, browser, task — intersect yields alpha, task
    expect(selectSelectedVisibleNames(state as never)).toEqual([
      'alpha',
      'task',
    ])
  })

  it('returns an empty array when selection is entirely hidden', () => {
    const skills = [makeSkill('task', 'claude-code')]
    const state = buildState({
      skills,
      searchQuery: 'task',
      selectedSkillNames: ['something-else'],
    })
    expect(selectSelectedVisibleNames(state as never)).toEqual([])
  })
})

describe('selectSelectedVisibleCount', () => {
  it('returns the count of selected-AND-visible names', () => {
    const skills = [
      makeSkill('alpha', 'claude-code'),
      makeSkill('browser', 'claude-code'),
      makeSkill('task', 'claude-code'),
    ]
    const state = buildState({
      skills,
      selectedSkillNames: ['alpha', 'task', 'hidden'],
    })
    expect(selectSelectedVisibleCount(state as never)).toBe(2)
  })
})

describe('selectHiddenSelectedCount', () => {
  it('returns the number of selected names that are NOT in the visible list', () => {
    const skills = [
      makeSkill('alpha', 'claude-code'),
      makeSkill('browser', 'claude-code'),
    ]
    const state = buildState({
      skills,
      selectedSkillNames: ['alpha', 'hidden-1', 'hidden-2'],
    })
    expect(selectHiddenSelectedCount(state as never)).toBe(2)
  })

  it('returns 0 when all selected names are visible', () => {
    const skills = [
      makeSkill('alpha', 'claude-code'),
      makeSkill('browser', 'claude-code'),
    ]
    const state = buildState({
      skills,
      selectedSkillNames: ['alpha', 'browser'],
    })
    expect(selectHiddenSelectedCount(state as never)).toBe(0)
  })
})

describe('selectInFlightDeleteNamesSet', () => {
  it('wraps the array in a Set for O(1) lookup', () => {
    const state = buildState({
      inFlightDeleteNames: ['a', 'b', 'c'],
    })
    const result = selectInFlightDeleteNamesSet(state as never)
    expect(result.has('a')).toBe(true)
    expect(result.has('z')).toBe(false)
    expect(result.size).toBe(3)
  })

  it('is memoized — returns the same Set reference for the same input array', () => {
    const state = buildState({
      inFlightDeleteNames: ['a'],
    })
    const result1 = selectInFlightDeleteNamesSet(state as never)
    const result2 = selectInFlightDeleteNamesSet(state as never)
    expect(result1).toBe(result2)
  })
})

describe('selectSelectedSkillNamesSet', () => {
  it('wraps selectedSkillNames in a Set', () => {
    const state = buildState({
      selectedSkillNames: ['x', 'y'],
    })
    const result = selectSelectedSkillNamesSet(state as never)
    expect(result.has('x')).toBe(true)
    expect(result.size).toBe(2)
  })

  it('is memoized', () => {
    const state = buildState({
      selectedSkillNames: ['x'],
    })
    const result1 = selectSelectedSkillNamesSet(state as never)
    const result2 = selectSelectedSkillNamesSet(state as never)
    expect(result1).toBe(result2)
  })
})
