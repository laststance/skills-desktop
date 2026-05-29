import { describe, expect, it } from 'vitest'

import type {
  AgentId,
  BulkDeleteResult,
  BulkUnlinkResult,
  SkillName,
} from '@/shared/types'
import { tombstoneId } from '@/shared/types'

import {
  computeRangeSelection,
  formatCascadeSummary,
  formatUnlinkSummary,
  getToolbarState,
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
    expect(result.primaryAriaLabel).toBe('Move 7 selected skills to app trash')
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
    expect(result.variantKey).toBe('global-zero')
    expect(result.isPrimaryDisabled).toBe(true)
    expect(result.primaryLabel).toBe('No visible skills')
    expect(result.primaryAriaLabel).toBe('No visible selected skills to delete')
  })

  it('uses unlink-specific zero-visible copy in agent view', () => {
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor' as AgentId,
      count: 3,
      visibleCount: 0,
      agentDisplayName: 'Cursor',
    })
    expect(result.variantKey).toBe('agent-zero')
    expect(result.isPrimaryDisabled).toBe(true)
    expect(result.primaryLabel).toBe('No visible skills')
    expect(result.primaryAriaLabel).toBe(
      'No visible selected skills to unlink from Cursor',
    )
  })

  it('labels the primary button with visible action targets when filters hide selected rows', () => {
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: 5,
      visibleCount: 2,
    })
    expect(result.isPrimaryDisabled).toBe(false)
    expect(result.primaryLabel).toBe('Delete 2 skills')
    expect(result.primaryAriaLabel).toBe(
      'Move 2 visible selected skills to app trash',
    )
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

  it('keeps orphan-cleared distinct from the Undo-facing "Deleted" phrase', () => {
    // Issue #71 PR-1: orphan-cleared has no tombstoneId so Undo can't restore
    // it — therefore the "Deleted N" wording must NOT include it (otherwise
    // the toast lies about how many rows the user can bring back).
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: 'task',
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaa'),
          symlinksRemoved: 1,
          cascadeAgents: ['cursor' as AgentId],
        },
        {
          skillName: 'abandoned',
          outcome: 'orphan-cleared',
          symlinksRemoved: 2,
          cascadeAgents: ['cursor' as AgentId, 'codex' as AgentId],
        },
      ],
    }

    // 1 truly-deleted (undoable) + 2 orphan symlinks swept (irreversible) +
    // 1 cascaded symlink from the deleted row. Three independent phrases.
    expect(formatCascadeSummary(result)).toBe(
      'Deleted 1 skill. Cleaned up 2 orphan symlinks. 1 symlink removed.',
    )
  })

  it('reports orphan-only batches without any "Deleted" phrase', () => {
    // The all-orphan case: e.g. user deleted the source first, then bulk
    // selected the broken-symlink rows in agent view to clean them up.
    // Nothing was tombstoned, so "Deleted" stays out of the message entirely.
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: 'abandoned-a',
          outcome: 'orphan-cleared',
          symlinksRemoved: 1,
          cascadeAgents: ['cursor' as AgentId],
        },
        {
          skillName: 'abandoned-b',
          outcome: 'orphan-cleared',
          symlinksRemoved: 3,
          cascadeAgents: [
            'cursor' as AgentId,
            'codex' as AgentId,
            'claude-code' as AgentId,
          ],
        },
      ],
    }

    expect(formatCascadeSummary(result)).toBe('Cleaned up 4 orphan symlinks.')
  })

  it('reports mixed orphan + error as separate phrases (no K-of-N form)', () => {
    // No tombstoned rows means the K-of-N "Deleted X of Y" form has nothing
    // to attach to; the error count gets its own standalone phrase instead.
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: 'abandoned',
          outcome: 'orphan-cleared',
          symlinksRemoved: 2,
          cascadeAgents: ['cursor' as AgentId, 'codex' as AgentId],
        },
        {
          skillName: 'locked',
          outcome: 'error',
          error: { message: 'EACCES', code: 'EACCES' },
        },
      ],
    }

    expect(formatCascadeSummary(result)).toBe(
      'Cleaned up 2 orphan symlinks. 1 deletion failed.',
    )
  })

  it('counts symlinks already unlinked when a multi-agent cleanup fails partway', () => {
    // Arrange — a 3-agent orphan record where the source reappeared between
    // the 2nd and 3rd unlink: codex + cursor committed to disk, then ESTALE.
    // The error variant carries the partial cascade so the count is honest.
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: 'abandoned',
          outcome: 'error',
          error: { message: 'Source skill exists', code: 'ESTALE' },
          symlinksRemoved: 2,
          cascadeAgents: ['codex' as AgentId, 'cursor' as AgentId],
        },
      ],
    }

    // Act
    const summary = formatCascadeSummary(result)

    // Assert — the 2 committed unlinks surface instead of an undercount of 0.
    expect(summary).toBe('Cleaned up 2 orphan symlinks. 1 deletion failed.')
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
