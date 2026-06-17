import { describe, expect, it } from 'vitest'

import type {
  ExcludableSkillTypeFilter,
  SkillTypeFilter,
} from '@/renderer/src/redux/slices/uiSlice'
import { repositoryId } from '@/shared/types'
import type {
  AbsolutePath,
  AgentId,
  BookmarkedSkill,
  RepositoryId,
  Skill,
  SkillName,
  SymlinkInfo,
} from '@/shared/types'

import {
  selectAnyInFlightRemovalSet,
  selectBookmarksWithInstallStatus,
  selectBulkSelectableVisibleSkillNames,
  selectFilteredSkills,
  selectFilteredSkillCount,
  selectHiddenSelectedCount,
  selectRepoFacetOptions,
  selectSelectedCount,
  selectSelectedSkillNamesSet,
  selectSelectedVisibleSkillObjects,
  selectSelectedVisibleCount,
  selectSelectedVisibleNames,
  selectSourceFilterViewModel,
  selectVisibleIneligibleSelectedCount,
  selectVisibleSkillNames,
} from './selectors'

/** Helper to build a minimal RootState for selector testing */
function buildState(overrides: {
  skills?: Skill[]
  searchQuery?: string
  searchScope?: 'name' | 'repo'
  selectedAgentId?: AgentId | null
  selectedSources?: RepositoryId[]
  sortOrder?: 'asc' | 'desc'
  skillTypeFilter?: SkillTypeFilter
  excludedSkillTypeFilters?: ExcludableSkillTypeFilter[]
  bookmarks?: BookmarkedSkill[]
  selectedSkillNames?: SkillName[]
  inFlightDeleteNames?: SkillName[]
  inFlightUnlinkNames?: SkillName[]
  protectedSkillNames?: SkillName[]
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
      selectedAddAgentIds: [],
      addingSymlinks: false,
      skillToCopy: null,
      selectedCopyAgentIds: [],
      copying: false,
      // v2.4 bulk-select state
      selectedSkillNames: overrides.selectedSkillNames ?? [],
      selectionAnchor: null,
      inFlightDeleteNames: overrides.inFlightDeleteNames ?? [],
      inFlightUnlinkNames: overrides.inFlightUnlinkNames ?? [],
      bulkDeleting: false,
      bulkUnlinking: false,
      bulkCopying: false,
      bulkCopyModalOpen: false,
      bulkProgress: null,
    },
    ui: {
      activeTab: 'installed' as const,
      searchQuery: overrides.searchQuery ?? '',
      searchScope: overrides.searchScope ?? ('name' as const),
      selectedSources: overrides.selectedSources ?? [],
      sourceStats: null,
      isRefreshing: false,
      selectedAgentId: overrides.selectedAgentId ?? null,
      sortOrder: overrides.sortOrder ?? 'asc',
      skillTypeFilter: overrides.skillTypeFilter ?? 'all',
      excludedSkillTypeFilters: overrides.excludedSkillTypeFilters ?? [],
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
    protect: {
      items: overrides.protectedSkillNames ?? [],
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
 * @param status - Agent symlink status for bulk-action eligibility tests.
 */
const makeSkill = (
  name: string,
  agentId: AgentId,
  isLocal = false,
  source?: string,
  status: SymlinkInfo['status'] = 'valid',
): Skill => ({
  name,
  description: `${name} skill`,
  path: isLocal
    ? `/home/user/.${agentId}/skills/${name}`
    : `/home/user/.agents/skills/${name}`,
  symlinkCount: isLocal || status === 'missing' ? 0 : 1,
  symlinks: [
    {
      agentId: agentId as SymlinkInfo['agentId'],
      agentName: agentId as SymlinkInfo['agentName'],
      linkPath: `/home/user/.${agentId}/skills/${name}`,
      targetPath: isLocal
        ? `/home/user/.${agentId}/skills/${name}`
        : `/home/user/.agents/skills/${name}`,
      status,
      isLocal,
    },
  ],
  isSource: !isLocal,
  isOrphan: false,
  ...(source
    ? {
        source: repositoryId(source),
        sourceUrl: `https://github.com/${source}.git`,
      }
    : {}),
})

/**
 * Build a skill spanning several agent slots — `makeSkill` only models one
 * agent, but the `'unique'` filter is about availability ACROSS agents, so
 * these tests need multi-slot skills. Each slot defaults to a valid symlink.
 * @param name - Skill name; also seeds the per-slot link/target paths.
 * @param slots - Per-agent slot specs (status defaults to `'valid'`, isLocal to false).
 * @param options.isOrphan - Mark the skill orphan (and non-source) to mirror scanner output.
 * @returns A `Skill` with one `symlinks` entry per slot; `symlinkCount` counts valid non-local slots; `isSource` is `true` unless `isOrphan`.
 * @example
 * makeMultiSlotSkill('u', [{ agentId: 'cursor' }, { agentId: 'codex' }]) // 2 valid slots
 */
const makeMultiSlotSkill = (
  name: string,
  slots: {
    agentId: AgentId
    isLocal?: boolean
    status?: SymlinkInfo['status']
  }[],
  options: { isOrphan?: boolean } = {},
): Skill => {
  const symlinks: SymlinkInfo[] = slots.map((slot) => {
    const isLocal = slot.isLocal ?? false
    return {
      agentId: slot.agentId as SymlinkInfo['agentId'],
      agentName: slot.agentId as SymlinkInfo['agentName'],
      linkPath: `/home/user/.${slot.agentId}/skills/${name}`,
      targetPath: isLocal
        ? `/home/user/.${slot.agentId}/skills/${name}`
        : `/home/user/.agents/skills/${name}`,
      status: slot.status ?? 'valid',
      isLocal,
    }
  })
  return {
    name,
    description: `${name} skill`,
    path: `/home/user/.agents/skills/${name}`,
    symlinkCount: symlinks.filter((s) => s.status === 'valid' && !s.isLocal)
      .length,
    symlinks,
    isSource: !options.isOrphan,
    isOrphan: options.isOrphan ?? false,
  }
}

describe('selectFilteredSkillCount', () => {
  it('counts the visible Installed rows that survived the active filters', () => {
    // Arrange — two unfiltered source skills, both visible
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
    ]
    const state = buildState({ skills })

    // Act
    const visibleRowCount = selectFilteredSkillCount(state as never)

    // Assert
    expect(visibleRowCount).toBe(2)
  })

  it('drops the count to zero when the search query matches no visible row', () => {
    // Arrange — query that matches none of the source skills
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
    ]
    const state = buildState({ skills, searchQuery: 'nonexistent' })

    // Act
    const visibleRowCount = selectFilteredSkillCount(state as never)

    // Assert
    expect(visibleRowCount).toBe(0)
  })
})

describe('selectFilteredSkills', () => {
  it('shows every source-dir skill in the SourceCard view when no agent is selected', () => {
    // Arrange
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
    ]
    const state = buildState({ skills })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(2)
  })

  it('hides agent-local-only skills from the SourceCard view (no agent selected)', () => {
    // Arrange — regression: clicking the SourceCard ("~/.agents/skills") used
    // to leak every claude-/cursor-local skill into the list because the
    // selector skipped filtering when selectedAgentId was null. Source-only
    // filter keeps the SourceCard view consistent with its label.
    const skills = [
      makeSkill('task', 'claude-code'), // source skill
      makeSkill('local-only', 'claude-code', true), // agent-local
    ]
    const state = buildState({ skills })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['task'])
  })

  it('narrows the list to skills whose name matches the search query', () => {
    // Arrange
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
    ]
    const state = buildState({ skills, searchQuery: 'task' })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('task')
  })

  it('matches the search query against the name only, never the description', () => {
    // Arrange
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
    ]
    const state = buildState({ skills, searchQuery: 'browse skill' })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(0)
  })

  it('matches the search query case-insensitively', () => {
    // Arrange
    const skills = [makeSkill('Task', 'claude-code')]
    const state = buildState({ skills, searchQuery: 'TASK' })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(1)
  })

  it('narrows the list to skills linked into the selected agent', () => {
    // Arrange
    const skills = [
      makeSkill('task', 'claude-code'),
      makeSkill('browse', 'cursor'),
    ]
    const state = buildState({ skills, selectedAgentId: 'cursor' })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('browse')
  })

  it('intersects the agent filter with the search query', () => {
    // Arrange
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

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('browse')
  })

  it('surfaces broken (orphan) symlinks for agent filter so user can clean them up', () => {
    // An orphan: source dir vanished, but cursor still has a dangling symlink
    // pointing at where the source used to live. The per-agent view must
    // surface this row so the right-click "Cleanup missing skills..." flow
    // has something to act on. Hiding it would silently strand the orphan
    // symlink in the agent dir.
    // Arrange
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
      isSource: false,
      isOrphan: true,
    }
    const state = buildState({ skills: [skill], selectedAgentId: 'cursor' })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('broken-skill')
    expect(result[0].isOrphan).toBe(true)
  })

  it('excludes "missing" symlink entries from agent filter', () => {
    // status:'missing' is the scanner's way of representing an agent slot
    // with NO on-disk symlink at all — there's nothing to surface or clean
    // up, so it must not pollute the per-agent list.
    // Arrange
    const skill: Skill = {
      name: 'unlinked-skill',
      description: 'unlinked',
      path: '/home/user/.agents/skills/unlinked-skill',
      symlinkCount: 0,
      symlinks: [
        {
          agentId: 'cursor' as SymlinkInfo['agentId'],
          agentName: 'Cursor' as SymlinkInfo['agentName'],
          linkPath: '/home/user/.cursor/skills/unlinked-skill',
          targetPath: '/home/user/.agents/skills/unlinked-skill',
          status: 'missing',
          isLocal: false,
        },
      ],
      isSource: true,
      isOrphan: false,
    }
    const state = buildState({ skills: [skill], selectedAgentId: 'cursor' })

    // Act & Assert
    expect(selectFilteredSkills(state as never)).toHaveLength(0)
  })

  it('shows an empty list when nothing matches the filters', () => {
    // Arrange
    const skills = [makeSkill('task', 'claude-code')]
    const state = buildState({ skills, searchQuery: 'nonexistent' })

    // Act & Assert
    expect(selectFilteredSkills(state as never)).toHaveLength(0)
  })

  it('orders skills A→Z by default', () => {
    // Arrange
    const skills = [
      makeSkill('zebra', 'claude-code'),
      makeSkill('alpha', 'claude-code'),
      makeSkill('middle', 'claude-code'),
    ]
    const state = buildState({ skills })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['alpha', 'middle', 'zebra'])
  })

  it('orders skills Z→A when the sort order is descending', () => {
    // Arrange
    const skills = [
      makeSkill('alpha', 'claude-code'),
      makeSkill('zebra', 'claude-code'),
      makeSkill('middle', 'claude-code'),
    ]
    const state = buildState({ skills, sortOrder: 'desc' })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['zebra', 'middle', 'alpha'])
  })

  it('shows only symlinked skills in the agent view when the Symlinked filter is active', () => {
    // Arrange
    const skills = [
      makeSkill('linked-one', 'cursor'),
      makeSkill('local-one', 'cursor', true),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      skillTypeFilter: 'symlinked',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('linked-one')
  })

  it('shows only local skills in the agent view when the Local filter is active', () => {
    // Arrange
    const skills = [
      makeSkill('linked-one', 'cursor'),
      makeSkill('local-one', 'cursor', true),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      skillTypeFilter: 'local',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('local-one')
  })

  it('subtracts excluded local skills from the all-types agent list', () => {
    // Arrange
    const skills = [
      makeSkill('linked-one', 'cursor'),
      makeSkill('local-one', 'cursor', true),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      excludedSkillTypeFilters: ['local'],
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['linked-one'])
  })

  it('surfaces both symlinked and local G-Stack skills when the G-Stack filter is active', () => {
    // Arrange — the G-Stack filter should match the same two production shapes
    // as the card badge: direct agent symlinks into `skills/gstack/` and local
    // sibling skills whose SKILL.md points into that tree.
    const linkedGStack = makeSkill('linked-gstack', 'cursor')
    linkedGStack.symlinks = [
      {
        ...linkedGStack.symlinks[0]!,
        targetPath:
          '/Users/me/.cursor/skills/gstack/linked-gstack' as AbsolutePath,
      },
    ]

    const localGStack = makeSkill('local-gstack', 'cursor', true)
    localGStack.symlinks = [
      {
        ...localGStack.symlinks[0]!,
        skillMdSymlinkTarget:
          '/Users/me/.cursor/skills/gstack/local-gstack/SKILL.md' as AbsolutePath,
      },
    ]

    const skills = [
      makeSkill('linked-plain', 'cursor'),
      linkedGStack,
      makeSkill('local-plain', 'cursor', true),
      localGStack,
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      skillTypeFilter: 'gstack',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((skill) => skill.name)).toEqual([
      'linked-gstack',
      'local-gstack',
    ])
  })

  it('subtracts local rows from the G-Stack include population', () => {
    // Arrange
    const linkedGStack = makeSkill('linked-gstack', 'cursor')
    linkedGStack.symlinks = [
      {
        ...linkedGStack.symlinks[0]!,
        targetPath:
          '/Users/me/.cursor/skills/gstack/linked-gstack' as AbsolutePath,
      },
    ]

    const localGStack = makeSkill('local-gstack', 'cursor', true)
    localGStack.symlinks = [
      {
        ...localGStack.symlinks[0]!,
        skillMdSymlinkTarget:
          '/Users/me/.cursor/skills/gstack/local-gstack/SKILL.md' as AbsolutePath,
      },
    ]

    const state = buildState({
      skills: [linkedGStack, localGStack],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'gstack',
      excludedSkillTypeFilters: ['local'],
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((skill) => skill.name)).toEqual(['linked-gstack'])
  })

  it('keeps G-Stack filtering scoped to the selected agent slot', () => {
    // Arrange — same skill name can exist as a G-Stack-managed sibling in one
    // agent and as a plain linked skill in another; the selected agent owns
    // the answer.
    const mixedSkill = makeSkill('mixed-skill', 'cursor')
    mixedSkill.symlinks = [
      mixedSkill.symlinks[0]!,
      {
        agentId: 'claude-code' as SymlinkInfo['agentId'],
        agentName: 'Claude Code' as SymlinkInfo['agentName'],
        linkPath: '/Users/me/.claude/skills/mixed-skill' as AbsolutePath,
        targetPath:
          '/Users/me/.claude/skills/gstack/mixed-skill' as AbsolutePath,
        status: 'valid',
        isLocal: false,
      },
    ]

    const state = buildState({
      skills: [mixedSkill],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'gstack',
    })

    // Act & Assert
    expect(selectFilteredSkills(state as never)).toHaveLength(0)
  })

  it('surfaces only orphan skills in the agent view when the Orphan filter is active', () => {
    // Arrange — mixed list: a normal symlinked skill (NOT orphan), a local
    // skill (NOT orphan), and an orphan whose source dir vanished but still has
    // a broken symlink under cursor. The Orphan filter must surface only the
    // orphan.
    const orphanSkill: Skill = {
      name: 'orphan-one',
      description: 'orphan',
      path: '/home/user/.agents/skills/orphan-one',
      symlinkCount: 1,
      symlinks: [
        {
          agentId: 'cursor' as SymlinkInfo['agentId'],
          agentName: 'Cursor' as SymlinkInfo['agentName'],
          linkPath: '/home/user/.cursor/skills/orphan-one',
          targetPath: '/home/user/.agents/skills/orphan-one',
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }
    const skills = [
      makeSkill('linked-one', 'cursor'),
      makeSkill('local-one', 'cursor', true),
      orphanSkill,
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      skillTypeFilter: 'orphan',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['orphan-one'])
  })

  it('hides an orphan stranded in another agent from the selected agent Orphan view', () => {
    // Arrange — Codex-flagged correctness contract: an orphan whose remaining
    // broken slot points at agent A must NOT surface when the user is viewing
    // agent B. Pass 1 (agent-slot gate) drops the row before Pass 2
    // (skill.isOrphan check) ever runs.
    const orphanForAgentA: Skill = {
      name: 'orphan-agent-a',
      description: 'orphan stranded in agent A',
      path: '/home/user/.agents/skills/orphan-agent-a',
      symlinkCount: 1,
      symlinks: [
        {
          agentId: 'claude-code' as SymlinkInfo['agentId'],
          agentName: 'Claude Code' as SymlinkInfo['agentName'],
          linkPath: '/home/user/.claude/skills/orphan-agent-a',
          targetPath: '/home/user/.agents/skills/orphan-agent-a',
          status: 'broken',
          isLocal: false,
        },
      ],
      isSource: false,
      isOrphan: true,
    }
    const state = buildState({
      skills: [orphanForAgentA],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'orphan',
    })

    // Act & Assert
    expect(selectFilteredSkills(state as never)).toHaveLength(0)
  })

  it('shows the empty Orphan state when the selected agent has no orphan skills', () => {
    // Arrange — empty-state contract: when the user picks Orphan but every
    // visible skill is healthy (isOrphan === false), the list is empty and the
    // empty-state copy ("No orphan skills for this agent") takes over.
    const skills = [
      makeSkill('linked-one', 'cursor'),
      makeSkill('local-one', 'cursor', true),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      skillTypeFilter: 'orphan',
    })

    // Act & Assert
    expect(selectFilteredSkills(state as never)).toHaveLength(0)
  })

  it('shows an empty list when the search query and type filter together exclude everything', () => {
    // Arrange
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

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(0)
  })

  it.each(['all', 'symlinked', 'local', 'gstack', 'orphan', 'unique'] as const)(
    'ignores the skillTypeFilter (%s) in the SourceCard view where source-only filtering rules',
    (skillTypeFilter) => {
      // Arrange — SourceCard view applies its own source-only filter, so
      // skillTypeFilter is moot here. `local-task` is hidden because it lives
      // outside SOURCE_DIR, not because of the symlinked/local filter.
      const skills = [
        makeSkill('task', 'claude-code'),
        makeSkill('local-task', 'cursor', true),
      ]
      const state = buildState({ skills, skillTypeFilter })

      // Act
      const result = selectFilteredSkills(state as never)

      // Assert
      expect(result.map((s) => s.name)).toEqual(['task'])
    },
  )

  it('shows a skill that is a real folder in only the selected agent under the Unique filter', () => {
    // Arrange — one real-folder slot, one agent → available to exactly one agent.
    const skills = [makeSkill('solo-local', 'claude-code', true)]
    const state = buildState({
      skills,
      selectedAgentId: 'claude-code',
      skillTypeFilter: 'unique',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['solo-local'])
  })

  it('shows a lone valid symlink under Unique because Unique asks "how many agents", not "is it a symlink"', () => {
    // Arrange — single valid symlink (isLocal false) in only the selected agent.
    const skills = [makeSkill('solo-symlink', 'cursor', false)]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      skillTypeFilter: 'unique',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['solo-symlink'])
  })

  it('hides a non-symlink skill duplicated across two agents, even viewed from an owning agent (Unique is not Local)', () => {
    // Arrange — two valid real-folder slots → available to 2 agents → NOT unique,
    // though every slot is Local. Viewed from claude-code, which owns one copy.
    const skills = [
      makeMultiSlotSkill('dup-local', [
        { agentId: 'claude-code', isLocal: true },
        { agentId: 'cursor', isLocal: true },
      ]),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'claude-code',
      skillTypeFilter: 'unique',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(0)
  })

  it('hides a universal skill that is valid-symlinked into many agents under Unique', () => {
    // Arrange — one source, valid symlinks in three agents → 3 valid slots.
    const skills = [
      makeMultiSlotSkill('universal', [
        { agentId: 'claude-code' },
        { agentId: 'cursor' },
        { agentId: 'codex' },
      ]),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'claude-code',
      skillTypeFilter: 'unique',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(0)
  })

  it('hides a skill whose only valid slot belongs to a different agent than the one in view', () => {
    // Arrange — unique to cursor, but the list is filtered for claude-code.
    const skills = [makeSkill('cursor-only', 'cursor', true)]
    const state = buildState({
      skills,
      selectedAgentId: 'claude-code',
      skillTypeFilter: 'unique',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(0)
  })

  it('treats a skill as Unique when its sole valid slot sits beside a broken slot in another agent', () => {
    // Arrange — valid in claude-code, broken symlink in cursor. A broken slot is
    // not "available", so the skill is still reachable by exactly one agent.
    const skills = [
      makeMultiSlotSkill('one-valid-one-broken', [
        { agentId: 'claude-code', isLocal: true, status: 'valid' },
        { agentId: 'cursor', isLocal: false, status: 'broken' },
      ]),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'claude-code',
      skillTypeFilter: 'unique',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['one-valid-one-broken'])
  })

  it('hides an orphan skill under Unique because orphans carry only broken slots (available to no agent)', () => {
    // Arrange — orphan: a broken slot only, zero valid slots anywhere.
    const skills = [
      makeMultiSlotSkill(
        'orphan-skill',
        [{ agentId: 'claude-code', isLocal: false, status: 'broken' }],
        { isOrphan: true },
      ),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'claude-code',
      skillTypeFilter: 'unique',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result).toHaveLength(0)
  })

  it('matches a repo-scope query against the skill repository slug', () => {
    // Arrange
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

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['mcp'])
  })

  it('drops source-less Local skills from repo-scope search even when their name matches', () => {
    // Arrange — critical regression guard: in repo mode, a skill without
    // `source` must never appear, otherwise the result becomes inconsistent
    // ("I searched a repo and got a non-repo skill") and the toggle loses its
    // meaning.
    const skills = [
      makeSkill('task', 'cursor'), // no source — Local-flavored
      makeSkill('task-from-repo', 'cursor', false, 'vercel-labs/skills'),
    ]
    const state = buildState({
      skills,
      searchQuery: 'task',
      searchScope: 'repo',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual([])
  })

  it('narrows to a single repo when only the source pill is set and no query is typed', () => {
    // Arrange
    const skills = [
      makeSkill('a', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('b', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('c', 'claude-code', false, 'pbakaus/impeccable'),
    ]
    const state = buildState({
      skills,
      selectedSources: [repositoryId('vercel-labs/skills')],
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['a', 'b'])
  })

  it('stacks the source pill with a name-scope query so both narrow the list', () => {
    // Arrange — scope is 'name' (default): the pill narrows population to one
    // repo, then the name query narrows further within that population.
    const skills = [
      makeSkill('alpha', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('beta', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('alpha-other', 'claude-code', false, 'pbakaus/impeccable'),
    ]
    const state = buildState({
      skills,
      selectedSources: [repositoryId('vercel-labs/skills')],
      searchQuery: 'alpha',
      searchScope: 'name',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['alpha'])
  })

  it('intersects the source pill with the agent filter as independent constraints', () => {
    // Arrange — per Issue 4 decision: the source pill is independent of the
    // agent pill. Selecting an agent must not silently reset the pill, and the
    // resulting list intersects both filters.
    const skills = [
      makeSkill('a', 'cursor', false, 'vercel-labs/skills'),
      makeSkill('b', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('c', 'cursor', false, 'pbakaus/impeccable'),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSources: [repositoryId('vercel-labs/skills')],
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['a'])
  })

  it('matches a name-scope query exactly as the pre-toggle default did', () => {
    // Arrange — regression guard: explicitly setting scope='name' must behave
    // identically to the pre-feature default so the toggle round-trips cleanly.
    const skills = [
      makeSkill('task', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('browse', 'cursor', false, 'vercel-labs/skills'),
    ]
    const state = buildState({
      skills,
      searchQuery: 'task',
      searchScope: 'name',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['task'])
  })

  it('keeps Local skills visible under repo scope when the query is empty', () => {
    // Arrange — the repo-scope filter only kicks in when there's a non-empty
    // query. An empty query in repo scope must still surface Local skills,
    // because the toggle is about what the query matches against, not a
    // standalone "show only repo skills" filter. Guards against a regression
    // where the scope itself was treated as a population filter.
    //
    // Use the agent view (selectedAgentId set) to actually exercise the
    // local-skill path: the SourceCard view (no agent) drops every isLocal
    // skill upstream, so a local fixture without selectedAgentId would never
    // reach the search-scope branch we want to lock down.
    const skills = [
      makeSkill('local-task', 'cursor', true),
      makeSkill('repo-task', 'cursor', false, 'vercel-labs/skills'),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      searchQuery: '',
      searchScope: 'repo',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert — both surface: agent filter narrows to cursor, neither query nor
    // scope are doing any filtering work with an empty query.
    expect(result.map((s) => s.name)).toEqual(['local-task', 'repo-task'])
  })

  it('composes the source pill, repo scope, and a matching query without short-circuiting', () => {
    // Arrange — three-way compound: pill narrows to one repo, scope=repo
    // searches within source strings, query matches that source — confirms the
    // filters compose without short-circuiting each other (per Issue 4).
    const skills = [
      makeSkill('a', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('b', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('c', 'claude-code', false, 'pbakaus/impeccable'),
    ]
    const state = buildState({
      skills,
      selectedSources: [repositoryId('vercel-labs/skills')],
      searchQuery: 'vercel',
      searchScope: 'repo',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual(['a', 'b'])
  })

  it('returns empty when the source pill and a repo-scope query point at different repos', () => {
    // Arrange — edge case: the pill says "in vercel-labs/skills" but the user
    // types 'figma' in repo scope. The compound filter must return empty — the
    // pill-narrowed population doesn't have a source matching 'figma', so
    // neither pill nor scope can produce a hit on its own.
    const skills = [
      makeSkill('a', 'claude-code', false, 'vercel-labs/skills'),
      makeSkill('b', 'claude-code', false, 'figma/mcp-server-guide'),
    ]
    const state = buildState({
      skills,
      selectedSources: [repositoryId('vercel-labs/skills')],
      searchQuery: 'figma',
      searchScope: 'repo',
    })

    // Act
    const result = selectFilteredSkills(state as never)

    // Assert
    expect(result.map((s) => s.name)).toEqual([])
  })

  it('counts repo facets after the agent and type gates while ignoring the source pill and query', () => {
    // Arrange
    const skills = [
      makeSkill('alpha', 'cursor', false, 'vercel-labs/skills'),
      makeSkill('beta', 'cursor', false, 'vercel-labs/skills'),
      makeSkill('gamma', 'cursor', false, 'pbakaus/impeccable'),
      makeSkill('local-only', 'cursor', true),
      makeSkill('other-agent', 'claude-code', false, 'vercel-labs/skills'),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSources: [repositoryId('pbakaus/impeccable')],
      searchQuery: 'nothing matches',
      searchScope: 'repo',
    })

    // Act & Assert
    expect(selectRepoFacetOptions(state as never)).toEqual([
      { source: repositoryId('pbakaus/impeccable'), count: 1 },
      { source: repositoryId('vercel-labs/skills'), count: 2 },
    ])
  })

  it('returns the same array reference on repeat reads so consumers do not re-render needlessly', () => {
    // Arrange
    const skills = [makeSkill('task', 'claude-code')]
    const state = buildState({ skills })

    // Act
    const result1 = selectFilteredSkills(state as never)
    const result2 = selectFilteredSkills(state as never)

    // Assert
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
  it('flags a bookmarked skill as installed when a matching skill name exists', () => {
    // Arrange
    const state = buildState({
      skills: [makeSkill('task', 'claude-code')],
      bookmarks: [makeBookmark('task', 'vercel-labs/skills')],
    })

    // Act
    const result = selectBookmarksWithInstallStatus(state as never)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].isInstalled).toBe(true)
  })

  it('flags a bookmarked skill as not installed when no matching skill exists', () => {
    // Arrange
    const state = buildState({
      skills: [makeSkill('browse', 'claude-code')],
      bookmarks: [makeBookmark('task', 'vercel-labs/skills')],
    })

    // Act
    const result = selectBookmarksWithInstallStatus(state as never)

    // Assert
    expect(result).toHaveLength(1)
    expect(result[0].isInstalled).toBe(false)
  })

  it('shows an empty bookmarks list when nothing is bookmarked', () => {
    // Arrange
    const state = buildState({
      skills: [makeSkill('task', 'claude-code')],
      bookmarks: [],
    })

    // Act & Assert
    expect(selectBookmarksWithInstallStatus(state as never)).toHaveLength(0)
  })

  it('returns the same array reference on repeat reads so consumers do not re-render needlessly', () => {
    // Arrange
    const state = buildState({
      skills: [makeSkill('task', 'claude-code')],
      bookmarks: [makeBookmark('task', 'vercel-labs/skills')],
    })

    // Act
    const result1 = selectBookmarksWithInstallStatus(state as never)
    const result2 = selectBookmarksWithInstallStatus(state as never)

    // Assert
    expect(result1).toBe(result2)
  })
})

describe('selectVisibleSkillNames', () => {
  it('lists the visible skill names in display order', () => {
    // Arrange
    const skills = [
      makeSkill('zebra', 'claude-code'),
      makeSkill('alpha', 'claude-code'),
    ]
    const state = buildState({ skills })

    // Act & Assert
    expect(selectVisibleSkillNames(state as never)).toEqual(['alpha', 'zebra'])
  })

  it('lists no names when the filter produces no rows', () => {
    // Arrange
    const skills = [makeSkill('task', 'claude-code')]
    const state = buildState({ skills, searchQuery: 'unmatched' })

    // Act & Assert
    expect(selectVisibleSkillNames(state as never)).toEqual([])
  })
})

describe('selectBulkSelectableVisibleSkillNames', () => {
  it('keeps broken agent rows visible but excludes them from bulk unlink names', () => {
    // Arrange
    const brokenSkill: Skill = {
      ...makeSkill('broken-skill', 'cursor'),
      isSource: false,
      isOrphan: true,
      symlinks: [
        {
          agentId: 'cursor' as AgentId,
          agentName: 'Cursor' as SymlinkInfo['agentName'],
          linkPath: '/home/user/.cursor/skills/broken-skill',
          targetPath: '/home/user/.agents/skills/broken-skill',
          status: 'broken',
          isLocal: false,
        },
      ],
    }
    const validSkill = makeSkill('valid-skill', 'cursor')
    const state = buildState({
      skills: [brokenSkill, validSkill],
      selectedAgentId: 'cursor',
    })

    // Act & Assert — the broken row stays in the visible list…
    expect(selectVisibleSkillNames(state as never)).toEqual([
      'broken-skill',
      'valid-skill',
    ])
    // …but is excluded from the bulk-unlink candidate names
    expect(selectBulkSelectableVisibleSkillNames(state as never)).toEqual([
      'valid-skill',
    ])
  })

  it('excludes inaccessible agent rows from bulk unlink names', () => {
    // Arrange
    const inaccessibleSkill: Skill = {
      ...makeSkill('manual-review', 'cursor'),
      symlinks: [
        {
          agentId: 'cursor' as AgentId,
          agentName: 'Cursor' as SymlinkInfo['agentName'],
          linkPath: '/home/user/.cursor/skills/manual-review',
          targetPath: '/home/user/.agents/skills/manual-review',
          status: 'inaccessible',
          isLocal: false,
        },
      ],
    }
    const state = buildState({
      skills: [inaccessibleSkill],
      selectedAgentId: 'cursor',
    })

    // Act & Assert — the row is still visible…
    expect(selectFilteredSkills(state as never)).toHaveLength(1)
    // …but excluded from the bulk-unlink candidate names
    expect(selectBulkSelectableVisibleSkillNames(state as never)).toEqual([])
  })

  it('excludes local agent folders from bulk unlink names', () => {
    // Arrange
    const localSkill: Skill = {
      ...makeSkill('local-only', 'cursor'),
      symlinks: [
        {
          agentId: 'cursor' as AgentId,
          agentName: 'Cursor' as SymlinkInfo['agentName'],
          linkPath: '/home/user/.cursor/skills/local-only',
          status: 'valid',
          isLocal: true,
        },
      ],
    }
    const validSymlinkSkill = makeSkill('valid-symlink', 'cursor')
    const state = buildState({
      skills: [localSkill, validSymlinkSkill],
      selectedAgentId: 'cursor',
    })

    // Act & Assert — the local folder stays in the visible list…
    expect(selectVisibleSkillNames(state as never)).toEqual([
      'local-only',
      'valid-symlink',
    ])
    // …but is excluded from the bulk-unlink candidate names
    expect(selectBulkSelectableVisibleSkillNames(state as never)).toEqual([
      'valid-symlink',
    ])
  })

  it('excludes protected valid agent rows from bulk unlink names', () => {
    // Arrange
    const protectedSkill = makeSkill('protected-skill', 'cursor')
    const availableSkill = makeSkill('available-skill', 'cursor')
    const state = buildState({
      skills: [protectedSkill, availableSkill],
      selectedAgentId: 'cursor',
      protectedSkillNames: ['protected-skill' as SkillName],
    })

    // Act
    const visibleNames = selectVisibleSkillNames(state as never)
    const bulkSelectableNames = selectBulkSelectableVisibleSkillNames(
      state as never,
    )

    // Assert
    expect(visibleNames).toEqual(['available-skill', 'protected-skill'])
    expect(bulkSelectableNames).toEqual(['available-skill'])
  })

  it('keeps protected rows selectable in global delete view so the confirm dialog can report the skip', () => {
    // Arrange
    const protectedSkill = makeSkill('protected-skill', 'cursor')
    const state = buildState({
      skills: [protectedSkill],
      selectedAgentId: null,
      protectedSkillNames: ['protected-skill' as SkillName],
    })

    // Act
    const bulkSelectableNames = selectBulkSelectableVisibleSkillNames(
      state as never,
    )

    // Assert
    expect(bulkSelectableNames).toEqual(['protected-skill'])
  })
})

describe('selectSelectedCount', () => {
  it('shows a zero selection count when nothing is ticked', () => {
    // Arrange
    const state = buildState({})

    // Act & Assert
    expect(selectSelectedCount(state as never)).toBe(0)
  })

  it('counts every ticked skill even when some are scrolled out of the visible list', () => {
    // Arrange
    const state = buildState({
      selectedSkillNames: ['a', 'b', 'c'],
    })

    // Act & Assert
    expect(selectSelectedCount(state as never)).toBe(3)
  })
})

describe('selectSelectedVisibleNames', () => {
  it('lists the ticked names that are currently visible in visible order, dropping ghosts', () => {
    // Arrange
    const skills = [
      makeSkill('alpha', 'claude-code'),
      makeSkill('browser', 'claude-code'),
      makeSkill('task', 'claude-code'),
    ]
    const state = buildState({
      skills,
      selectedSkillNames: ['task', 'alpha', 'ghost'],
    })

    // Act & Assert — visible order is alphabetical (alpha, browser, task);
    // intersecting the selection yields alpha, task and drops 'ghost'
    expect(selectSelectedVisibleNames(state as never)).toEqual([
      'alpha',
      'task',
    ])
  })

  it('lists no names when the whole selection is hidden by the active filter', () => {
    // Arrange
    const skills = [makeSkill('task', 'claude-code')]
    const state = buildState({
      skills,
      searchQuery: 'task',
      selectedSkillNames: ['something-else'],
    })

    // Act & Assert
    expect(selectSelectedVisibleNames(state as never)).toEqual([])
  })
})

describe('selectSelectedVisibleCount', () => {
  it('counts only the ticked skills that are currently visible', () => {
    // Arrange
    const skills = [
      makeSkill('alpha', 'claude-code'),
      makeSkill('browser', 'claude-code'),
      makeSkill('task', 'claude-code'),
    ]
    const state = buildState({
      skills,
      selectedSkillNames: ['alpha', 'task', 'hidden'],
    })

    // Act & Assert
    expect(selectSelectedVisibleCount(state as never)).toBe(2)
  })
})

describe('selectHiddenSelectedCount', () => {
  it('counts the ticked skills scrolled or filtered out of the visible list', () => {
    // Arrange
    const skills = [
      makeSkill('alpha', 'claude-code'),
      makeSkill('browser', 'claude-code'),
    ]
    const state = buildState({
      skills,
      selectedSkillNames: ['alpha', 'hidden-1', 'hidden-2'],
    })

    // Act & Assert
    expect(selectHiddenSelectedCount(state as never)).toBe(2)
  })

  it('reports zero hidden selections when every ticked skill is visible', () => {
    // Arrange
    const skills = [
      makeSkill('alpha', 'claude-code'),
      makeSkill('browser', 'claude-code'),
    ]
    const state = buildState({
      skills,
      selectedSkillNames: ['alpha', 'browser'],
    })

    // Act & Assert
    expect(selectHiddenSelectedCount(state as never)).toBe(0)
  })

  it('does not count a visible-but-ineligible agent row as hidden by the filter', () => {
    // Arrange
    const skills = [
      makeSkill('valid-task', 'cursor'),
      makeSkill('broken-task', 'cursor', false, undefined, 'broken'),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSkillNames: ['valid-task', 'broken-task'],
    })

    // Act & Assert
    expect(selectHiddenSelectedCount(state as never)).toBe(0)
  })
})

describe('selectVisibleIneligibleSelectedCount', () => {
  it('counts ticked rows that are visible yet excluded from the bulk action', () => {
    // Arrange
    const skills = [
      makeSkill('valid-task', 'cursor'),
      makeSkill('broken-task', 'cursor', false, undefined, 'broken'),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSkillNames: ['valid-task', 'broken-task', 'hidden-task'],
    })

    // Act & Assert
    expect(selectVisibleIneligibleSelectedCount(state as never)).toBe(1)
  })
})

describe('selectAnyInFlightRemovalSet', () => {
  it('marks the rows of an active bulk delete as fading via Set membership', () => {
    // Arrange
    const state = buildState({
      inFlightDeleteNames: ['skill-a', 'skill-b'],
    })

    // Act
    const inFlightSet = selectAnyInFlightRemovalSet(state as never)

    // Assert
    expect(inFlightSet.has('skill-a')).toBe(true)
    expect(inFlightSet.has('skill-b')).toBe(true)
    expect(inFlightSet.has('skill-c')).toBe(false)
    expect(inFlightSet.size).toBe(2)
  })

  it('returns the shared empty Set when no bulk delete is in flight so idle renders allocate nothing', () => {
    // Arrange
    const stateWithoutDeletes = buildState({
      inFlightDeleteNames: [],
    })
    const otherIdleState = buildState({
      inFlightDeleteNames: [],
      selectedSkillNames: ['unrelated'],
    })

    // Act
    const firstIdleSet = selectAnyInFlightRemovalSet(
      stateWithoutDeletes as never,
    )
    const secondIdleSet = selectAnyInFlightRemovalSet(otherIdleState as never)

    // Assert
    expect(firstIdleSet.size).toBe(0)
    expect(firstIdleSet).toBe(secondIdleSet)
  })
})

describe('selectSelectedSkillNamesSet', () => {
  it('exposes the ticked skill names as a Set for fast membership checks', () => {
    // Arrange
    const state = buildState({
      selectedSkillNames: ['x', 'y'],
    })

    // Act
    const result = selectSelectedSkillNamesSet(state as never)

    // Assert
    expect(result.has('x')).toBe(true)
    expect(result.size).toBe(2)
  })

  it('returns the same Set reference on repeat reads so consumers do not re-render needlessly', () => {
    // Arrange
    const state = buildState({
      selectedSkillNames: ['x'],
    })

    // Act
    const result1 = selectSelectedSkillNamesSet(state as never)
    const result2 = selectSelectedSkillNamesSet(state as never)

    // Assert
    expect(result1).toBe(result2)
  })
})

describe('selectSelectedVisibleSkillObjects', () => {
  it('resolves the ticked names to their full skill objects so the bulk-copy modal can read each path', () => {
    // Arrange — three live skills, two of them ticked, no filter active
    const skills = [
      makeSkill('alpha', 'claude-code'),
      makeSkill('beta', 'claude-code'),
      makeSkill('gamma', 'claude-code'),
    ]
    const state = buildState({
      skills,
      selectedSkillNames: ['gamma', 'alpha'],
    })

    // Act
    const result = selectSelectedVisibleSkillObjects(state as never)

    // Assert — kept in items order (alpha, gamma), each a full Skill with a path
    expect(result.map((skill) => skill.name)).toEqual(['alpha', 'gamma'])
    expect(result[0].path).toBe('/home/user/.agents/skills/alpha')
  })

  it('drops ticked names whose skill is gone so a stale selection cannot copy a phantom', () => {
    // Arrange — "ghost" was ticked then removed by a background refresh
    const skills = [makeSkill('alpha', 'claude-code')]
    const state = buildState({
      skills,
      selectedSkillNames: ['alpha', 'ghost'],
    })

    // Act
    const result = selectSelectedVisibleSkillObjects(state as never)

    // Assert
    expect(result.map((skill) => skill.name)).toEqual(['alpha'])
  })

  it('excludes ticked skills hidden by the active filter so bulk copy honors the "will not be affected" promise', () => {
    // Arrange — alpha and beta both ticked, but a search query hides beta
    const skills = [
      makeSkill('alpha', 'claude-code'),
      makeSkill('beta', 'claude-code'),
    ]
    const state = buildState({
      skills,
      selectedSkillNames: ['alpha', 'beta'],
      searchQuery: 'alpha',
    })

    // Act
    const result = selectSelectedVisibleSkillObjects(state as never)

    // Assert — only the visible-and-ticked skill survives; hidden beta is dropped,
    // matching the bulk delete/unlink behavior the toolbar badge advertises
    expect(result.map((skill) => skill.name)).toEqual(['alpha'])
  })
})

describe('selectSourceFilterViewModel', () => {
  it('shows the "All repos" trigger and a generic aria-label when nothing is ticked', () => {
    // Arrange — one repo skill in the cursor view, but no include filter yet
    const skills = [makeSkill('a', 'cursor', false, 'vercel-labs/skills')]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSources: [],
    })

    // Act
    const viewModel = selectSourceFilterViewModel(state as never)

    // Assert — empty-state defaults; the lone facet repo renders unchecked
    expect(viewModel.triggerLabel).toBe('All repos')
    expect(viewModel.triggerAriaLabel).toBe('Filter by source repository')
    expect(viewModel.validRepoIds).toEqual([])
    expect(viewModel.localHiddenCount).toBe(0)
    expect(viewModel.dropdownRows).toEqual([
      { source: repositoryId('vercel-labs/skills'), count: 1, checked: false },
    ])
  })

  it('names the single ticked repo in the trigger, aria-label, and checkbox tick', () => {
    // Arrange — two skills from one repo, that repo ticked
    const skills = [
      makeSkill('a', 'cursor', false, 'vercel-labs/skills'),
      makeSkill('b', 'cursor', false, 'vercel-labs/skills'),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSources: [repositoryId('vercel-labs/skills')],
    })

    // Act
    const viewModel = selectSourceFilterViewModel(state as never)

    // Assert — single-repo phrasing; row is checked and validRepoIds holds it
    expect(viewModel.triggerLabel).toBe('vercel-labs/skills')
    expect(viewModel.triggerAriaLabel).toBe(
      'Filtering by source repository vercel-labs/skills',
    )
    expect(viewModel.validRepoIds).toEqual([repositoryId('vercel-labs/skills')])
    expect(viewModel.dropdownRows).toEqual([
      { source: repositoryId('vercel-labs/skills'), count: 2, checked: true },
    ])
  })

  it('collapses the trigger to "N repos" and spells out the aria-label for multiple ticks', () => {
    // Arrange — one skill per repo, both repos ticked
    const skills = [
      makeSkill('a', 'cursor', false, 'vercel-labs/skills'),
      makeSkill('b', 'cursor', false, 'pbakaus/impeccable'),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSources: [
        repositoryId('vercel-labs/skills'),
        repositoryId('pbakaus/impeccable'),
      ],
    })

    // Act
    const viewModel = selectSourceFilterViewModel(state as never)

    // Assert — compact count label; aria spells each repo in selection order
    expect(viewModel.triggerLabel).toBe('2 repos')
    expect(viewModel.triggerAriaLabel).toBe(
      'Filtering by 2 source repositories: vercel-labs/skills, pbakaus/impeccable',
    )
    // Every facet repo is ticked → "Select all" is pointless
    expect(viewModel.isSelectAllDisabled).toBe(true)
  })

  it('summarizes the overflow as "and N more" when the aria-label exceeds the spelled-repo cap', () => {
    // Arrange — four repos ticked, one past SOURCE_FILTER_MAX_VISIBLE_REPOS (3),
    // so the screen-reader label must name the first three then summarize the
    // remainder instead of reading an unbounded list.
    const skills = [
      makeSkill('a', 'cursor', false, 'aaa/repo'),
      makeSkill('b', 'cursor', false, 'bbb/repo'),
      makeSkill('c', 'cursor', false, 'ccc/repo'),
      makeSkill('d', 'cursor', false, 'ddd/repo'),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSources: [
        repositoryId('aaa/repo'),
        repositoryId('bbb/repo'),
        repositoryId('ccc/repo'),
        repositoryId('ddd/repo'),
      ],
    })

    // Act
    const viewModel = selectSourceFilterViewModel(state as never)

    // Assert — first three repos spelled in selection order, fourth folded into "and 1 more"
    expect(viewModel.triggerAriaLabel).toBe(
      'Filtering by 4 source repositories: aaa/repo, bbb/repo, ccc/repo, and 1 more',
    )
  })

  it('keeps a ticked repo with zero remaining rows in the dropdown but out of validRepoIds', () => {
    // A repo the user ticked that no longer backs any visible facet row (here a
    // not-yet-pruned stale id) must still render — checked — so the user can
    // untick it; but it must be excluded from the bulk-confirm scope snapshot.
    // Arrange
    const skills = [makeSkill('a', 'cursor', false, 'vercel-labs/skills')]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSources: [
        repositoryId('vercel-labs/skills'),
        repositoryId('stale/removed-repo'),
      ],
    })

    // Act
    const viewModel = selectSourceFilterViewModel(state as never)

    // Assert — stale repo sorts first (alpha), count 0, still checked…
    expect(viewModel.dropdownRows).toEqual([
      { source: repositoryId('stale/removed-repo'), count: 0, checked: true },
      { source: repositoryId('vercel-labs/skills'), count: 1, checked: true },
    ])
    // …but only the facet-backed repo survives into the actionable scope
    expect(viewModel.validRepoIds).toEqual([repositoryId('vercel-labs/skills')])
  })

  it('counts source-less local skills suppressed by an active repo filter', () => {
    // Arrange — cursor view: one repo skill plus two source-less local skills,
    // repo filter active
    const skills = [
      makeSkill('linked', 'cursor', false, 'vercel-labs/skills'),
      makeSkill('local-one', 'cursor', true),
      makeSkill('local-two', 'cursor', true),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSources: [repositoryId('vercel-labs/skills')],
    })

    // Act
    const viewModel = selectSourceFilterViewModel(state as never)

    // Assert — both locals are hidden by the include filter
    expect(viewModel.localHiddenCount).toBe(2)
  })

  it('reports zero hidden locals when no repo filter is active', () => {
    // Arrange — same source-less locals, but the include filter is empty
    const skills = [
      makeSkill('linked', 'cursor', false, 'vercel-labs/skills'),
      makeSkill('local-one', 'cursor', true),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSources: [],
    })

    // Act
    const viewModel = selectSourceFilterViewModel(state as never)

    // Assert — nothing is "hidden" because the filter is showing everything
    expect(viewModel.localHiddenCount).toBe(0)
  })

  it('flags hasNoRepositories and an empty dropdown when no skill carries a source', () => {
    // Arrange — only an agent-local skill exists, so the facet is empty
    const skills = [makeSkill('local-only', 'cursor', true)]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSources: [],
    })

    // Act
    const viewModel = selectSourceFilterViewModel(state as never)

    // Assert — the component shows its "no repositories" empty state
    expect(viewModel.hasNoRepositories).toBe(true)
    expect(viewModel.dropdownRows).toEqual([])
  })

  it('leaves "Select all" enabled while at least one facet repo is unticked', () => {
    // Arrange — two facet repos, only one ticked
    const skills = [
      makeSkill('a', 'cursor', false, 'vercel-labs/skills'),
      makeSkill('b', 'cursor', false, 'pbakaus/impeccable'),
    ]
    const state = buildState({
      skills,
      selectedAgentId: 'cursor',
      selectedSources: [repositoryId('vercel-labs/skills')],
    })

    // Act
    const viewModel = selectSourceFilterViewModel(state as never)

    // Assert — there is still a repo left to add, so the action stays live
    expect(viewModel.isSelectAllDisabled).toBe(false)
  })
})
