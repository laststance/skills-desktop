import { describe, expect, it } from 'vitest'

import type { BookmarkedSkill, Skill, SymlinkInfo } from '../../../shared/types'

import {
  selectBookmarksWithInstallStatus,
  selectFilteredSkills,
} from './selectors'

/** Helper to build a minimal RootState for selector testing */
function buildState(overrides: {
  skills?: Skill[]
  searchQuery?: string
  selectedAgentId?: string | null
  sortOrder?: 'asc' | 'desc'
  skillTypeFilter?: 'all' | 'symlinked' | 'local'
  bookmarks?: BookmarkedSkill[]
}) {
  return {
    skills: {
      items: overrides.skills ?? [],
      selectedSkill: null,
      loading: false,
      error: null,
      skillToUnlink: null,
      unlinking: false,
      skillToDelete: null,
      deleting: false,
      skillToAddSymlinks: null,
      addingSymlinks: false,
      skillToCopy: null,
      copying: false,
    },
    ui: {
      searchQuery: overrides.searchQuery ?? '',
      sourceStats: null,
      isRefreshing: false,
      selectedAgentId: overrides.selectedAgentId ?? null,
      sortOrder: overrides.sortOrder ?? 'asc',
      skillTypeFilter: overrides.skillTypeFilter ?? 'all',
      isSyncing: false,
      syncPreview: null,
      error: null,
      selectedBookmarkForDetail: null,
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
      hue: 195,
      mode: 'dark' as const,
      preset: 'neutral-dark',
      presetType: 'neutral' as const,
    },
    marketplace: {
      status: 'idle' as const,
      searchQuery: '',
      searchResults: [],
      selectedSkill: null,
      installProgress: null,
      skillToRemove: null,
      error: null,
    },
    bookmarks: {
      items: overrides.bookmarks ?? [],
    },
  }
}

/**
 * @param isLocal - false = symlinked (default), true = local folder
 */
const makeSkill = (name: string, agentId: string, isLocal = false): Skill => ({
  name,
  description: `${name} skill`,
  path: `/home/user/.agents/skills/${name}`,
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
})

describe('selectFilteredSkills', () => {
  it('returns all skills when no filters active', () => {
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
    ]
    const state = buildState({ skills })
    expect(selectFilteredSkills(state as never)).toHaveLength(2)
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
    const state = buildState({ skills, sortOrder: 'asc' })
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

  it('skillTypeFilter is ignored in global view (no agent selected)', () => {
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
    ]
    const state = buildState({ skills, skillTypeFilter: 'symlinked' })
    expect(selectFilteredSkills(state as never)).toHaveLength(2)
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
  repo,
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
