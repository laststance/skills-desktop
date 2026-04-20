import { describe, expect, it } from 'vitest'

import type {
  AgentId,
  BulkDeleteResult,
  BulkUnlinkResult,
  RepositoryId,
  Skill,
  SkillName,
} from '../../../../shared/types'
import { tombstoneId } from '../../../../shared/types'

import {
  computeRangeSelection,
  formatCascadeSummary,
  formatUnlinkSummary,
  getToolbarState,
  isCliManagedSkill,
  partitionSkillsForDelete,
} from './bulkDeleteHelpers'

describe('getToolbarState', () => {
  it('returns the global-single variant for a single selection in global view', () => {
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: 1,
      visibleCount: 1,
    })
    expect(result.variantKey).toBe('global-single')
    expect(result.primaryLabel).toBe('Delete skill')
    expect(result.isDestructive).toBe(true)
    expect(result.isPrimaryDisabled).toBe(false)
  })

  it('returns the global-multi variant with the count embedded', () => {
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: 7,
      visibleCount: 7,
    })
    expect(result.variantKey).toBe('global-multi')
    expect(result.primaryLabel).toBe('Delete 7 skills')
    expect(result.primaryAriaLabel).toBe('Delete 7 selected skills permanently')
    expect(result.isDestructive).toBe(true)
  })

  it('returns the agent-single variant (non-destructive) with placeholder label when no display name', () => {
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor' as AgentId,
      count: 1,
      visibleCount: 1,
    })
    expect(result.variantKey).toBe('agent-single')
    expect(result.primaryLabel).toBe('Unlink from agent')
    expect(result.isDestructive).toBe(false)
  })

  it('embeds the agentDisplayName directly into the agent-single label', () => {
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor' as AgentId,
      count: 1,
      visibleCount: 1,
      agentDisplayName: 'Cursor',
    })
    expect(result.primaryLabel).toBe('Unlink from Cursor')
    expect(result.primaryAriaLabel).toBe('Unlink selected skill from Cursor')
  })

  it('returns the agent-multi variant with the count and placeholder label', () => {
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor' as AgentId,
      count: 4,
      visibleCount: 4,
    })
    expect(result.variantKey).toBe('agent-multi')
    expect(result.primaryLabel).toBe('Unlink 4 from agent')
    expect(result.isDestructive).toBe(false)
  })

  it('embeds the agentDisplayName into the agent-multi label', () => {
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor' as AgentId,
      count: 4,
      visibleCount: 4,
      agentDisplayName: 'Cursor',
    })
    expect(result.primaryLabel).toBe('Unlink 4 from Cursor')
    expect(result.primaryAriaLabel).toBe('Unlink 4 selected skills from Cursor')
  })

  it('disables the primary button when visibleCount is 0 (hidden-only selection)', () => {
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: 5, // user has 5 selected globally
      visibleCount: 0, // but search filter leaves none visible
    })
    expect(result.isPrimaryDisabled).toBe(true)
  })

  it('keeps the primary enabled when visibleCount > 0 even if it is lower than count', () => {
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: 5,
      visibleCount: 2,
    })
    expect(result.isPrimaryDisabled).toBe(false)
    // Label reflects full selection count per v2.4 spec
    expect(result.primaryLabel).toBe('Delete 5 skills')
  })
})

describe('formatCascadeSummary', () => {
  it('formats a fully successful delete with symlinks', () => {
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: 'task',
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaa'),
          symlinksRemoved: 2,
          cascadeAgents: ['cursor' as AgentId, 'claude-code' as AgentId],
        },
        {
          skillName: 'theme-generator',
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-theme-generator-bbbb'),
          symlinksRemoved: 1,
          cascadeAgents: ['cursor' as AgentId],
        },
      ],
    }

    expect(formatCascadeSummary(result)).toBe(
      'Deleted 2 skills. 3 symlinks removed.',
    )
  })

  it('handles the partial-failure case with explicit "K of N"', () => {
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: 'task',
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaa'),
          symlinksRemoved: 1,
          cascadeAgents: [],
        },
        {
          skillName: 'locked',
          outcome: 'error',
          error: { message: 'EACCES', code: 'EACCES' },
        },
      ],
    }

    expect(formatCascadeSummary(result)).toBe(
      'Deleted 1 of 2 skills. 1 symlink removed.',
    )
  })

  it('omits the symlinks phrase when no symlinks cascaded', () => {
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: 'task',
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaa'),
          symlinksRemoved: 0,
          cascadeAgents: [],
        },
      ],
    }

    expect(formatCascadeSummary(result)).toBe('Deleted 1 skill.')
  })

  it('uses singular "skill"/"symlink" for count === 1', () => {
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: 'task',
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaa'),
          symlinksRemoved: 1,
          cascadeAgents: [],
        },
      ],
    }

    expect(formatCascadeSummary(result)).toBe(
      'Deleted 1 skill. 1 symlink removed.',
    )
  })
})

describe('formatUnlinkSummary', () => {
  it('formats an all-success unlink', () => {
    const result: BulkUnlinkResult = {
      items: [
        { skillName: 'task', outcome: 'unlinked' },
        { skillName: 'theme', outcome: 'unlinked' },
      ],
    }
    expect(formatUnlinkSummary(result, 'Cursor')).toBe(
      'Unlinked 2 skills from Cursor.',
    )
  })

  it('formats a partial-failure unlink', () => {
    const result: BulkUnlinkResult = {
      items: [
        { skillName: 'task', outcome: 'unlinked' },
        { skillName: 'locked', outcome: 'error', error: { message: 'EACCES' } },
      ],
    }
    expect(formatUnlinkSummary(result, 'Cursor')).toBe(
      'Unlinked 1 of 2 skills from Cursor.',
    )
  })

  it('uses singular skill for count === 1', () => {
    const result: BulkUnlinkResult = {
      items: [{ skillName: 'task', outcome: 'unlinked' }],
    }
    expect(formatUnlinkSummary(result, 'Cursor')).toBe(
      'Unlinked 1 skill from Cursor.',
    )
  })
})

describe('computeRangeSelection', () => {
  const visible: SkillName[] = ['alpha', 'browser', 'task', 'theme', 'zebra']

  it('returns the inclusive slice when anchor is below target', () => {
    expect(computeRangeSelection('task', 'zebra', visible)).toEqual([
      'task',
      'theme',
      'zebra',
    ])
  })

  it('returns the inclusive slice when anchor is above target', () => {
    expect(computeRangeSelection('zebra', 'task', visible)).toEqual([
      'task',
      'theme',
      'zebra',
    ])
  })

  it('returns a single-item range when anchor === target', () => {
    expect(computeRangeSelection('task', 'task', visible)).toEqual(['task'])
  })

  it('falls back to just [target] when anchor is null', () => {
    expect(computeRangeSelection(null, 'task', visible)).toEqual(['task'])
  })

  it('falls back to just [target] when anchor is filtered out', () => {
    expect(
      computeRangeSelection('removed-by-search', 'zebra', visible),
    ).toEqual(['zebra'])
  })

  it('falls back to just [target] when target is missing (edge case)', () => {
    expect(computeRangeSelection('task', 'missing', visible)).toEqual([
      'missing',
    ])
  })

  it('handles the first and last items correctly', () => {
    expect(computeRangeSelection('alpha', 'zebra', visible)).toEqual(visible)
  })
})

describe('partitionSkillsForDelete', () => {
  // Keep fixture authoring small: only `name` and `source` drive the bucket
  // decision; the other Skill fields are cast over with `as Skill`.
  const mkSkill = (name: string, source?: string): Skill =>
    ({
      name: name as SkillName,
      source:
        source !== undefined ? (source as unknown as RepositoryId) : undefined,
    }) as Skill

  it('routes skills with a `source` field into cliNames', () => {
    const items = [
      mkSkill('task'),
      mkSkill('brainstorming', 'vercel-labs/agent-skills'),
    ]
    const result = partitionSkillsForDelete(
      ['task', 'brainstorming'] as SkillName[],
      items,
    )
    expect(result).toEqual({
      cliNames: ['brainstorming'],
      plainNames: ['task'],
    })
  })

  it('routes skills without a `source` field into plainNames', () => {
    const items = [mkSkill('task'), mkSkill('theme')]
    const result = partitionSkillsForDelete(
      ['task', 'theme'] as SkillName[],
      items,
    )
    expect(result).toEqual({
      cliNames: [],
      plainNames: ['task', 'theme'],
    })
  })

  it('puts stale selection entries (not in items) into plainNames', () => {
    const items = [mkSkill('task', 'vercel-labs/agent-skills')]
    // Ghost name "removed" is not in items at all.
    const result = partitionSkillsForDelete(
      ['task', 'removed'] as SkillName[],
      items,
    )
    expect(result.cliNames).toEqual(['task'])
    expect(result.plainNames).toEqual(['removed'])
  })

  it('preserves selection order per bucket', () => {
    const items = [
      mkSkill('a'),
      mkSkill('b', 'owner/repo'),
      mkSkill('c'),
      mkSkill('d', 'owner/repo'),
    ]
    const result = partitionSkillsForDelete(
      ['d', 'a', 'c', 'b'] as SkillName[],
      items,
    )
    // Relative order within each bucket must mirror input order.
    expect(result.cliNames).toEqual(['d', 'b'])
    expect(result.plainNames).toEqual(['a', 'c'])
  })

  it('handles empty selection', () => {
    const items = [mkSkill('task')]
    const result = partitionSkillsForDelete([] as SkillName[], items)
    expect(result).toEqual({ cliNames: [], plainNames: [] })
  })

  it("preserves duplicate names in the same bucket (dedup is the caller's job)", () => {
    // Duplicate selections should not be silently deduplicated here — the
    // partition contract is "union equals input" (see docstring). Dedup
    // would hide a real selection bug in callers upstream.
    const items = [mkSkill('task', 'owner/repo'), mkSkill('theme')]
    const result = partitionSkillsForDelete(
      ['task', 'task', 'theme', 'theme'] as SkillName[],
      items,
    )
    expect(result.cliNames).toEqual(['task', 'task'])
    expect(result.plainNames).toEqual(['theme', 'theme'])
  })

  it('treats a falsy source (empty string) as CLI-managed since source is present', () => {
    // `isCliManagedSkill` keys on `source !== undefined`, not truthiness —
    // an empty-string source is still a lock-file entry (e.g. a local-only
    // CLI install with no remote repo). Routing it to plainNames would
    // leak a stale lock entry. See isCliManagedSkill docstring.
    const items = [mkSkill('task', '')]
    const result = partitionSkillsForDelete(['task'] as SkillName[], items)
    expect(result.cliNames).toEqual(['task'])
    expect(result.plainNames).toEqual([])
  })
})

describe('isCliManagedSkill', () => {
  const mkSkill = (source: string | undefined): Skill =>
    ({
      name: 'task' as SkillName,
      source:
        source === undefined ? undefined : (source as unknown as RepositoryId),
    }) as Skill

  it('returns true when source is a non-empty repository id', () => {
    expect(isCliManagedSkill(mkSkill('vercel-labs/agent-skills'))).toBe(true)
  })

  it('returns true for an empty-string source (source field present)', () => {
    // `source = ''` still means the skill was registered via `npx skills add`
    // with an empty repo field. Must NOT fall through to plainNames.
    expect(isCliManagedSkill(mkSkill(''))).toBe(true)
  })

  it('returns false when source is undefined', () => {
    expect(isCliManagedSkill(mkSkill(undefined))).toBe(false)
  })
})
