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
  countOrphanSymlinksRemoved,
  formatCascadeSummary,
  formatUnlinkSummary,
  getToolbarState,
} from './bulkDeleteHelpers'

describe('getToolbarState', () => {
  it('offers a destructive "Delete skill" button for one skill in global view', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: 1,
      visibleCount: 1,
    })

    // Assert
    expect(result.variantKey).toBe('global-single')
    expect(result.primaryLabel).toBe('Delete skill')
    expect(result.isDestructive).toBe(true)
    expect(result.isPrimaryDisabled).toBe(false)
  })

  it('shows the selected count in the "Delete N skills" button in global view', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: 7,
      visibleCount: 7,
    })

    // Assert
    expect(result.variantKey).toBe('global-multi')
    expect(result.primaryLabel).toBe('Delete 7 skills')
    expect(result.primaryAriaLabel).toBe('Move 7 selected skills to app trash')
    expect(result.isDestructive).toBe(true)
  })

  it('offers a non-destructive unlink button with a generic agent label when the display name is unknown', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor' as AgentId,
      count: 1,
      visibleCount: 1,
    })

    // Assert
    expect(result.variantKey).toBe('agent-single')
    expect(result.primaryLabel).toBe('Unlink from agent')
    expect(result.isDestructive).toBe(false)
  })

  it('names the agent in the single-skill unlink button when a display name is given', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor' as AgentId,
      count: 1,
      visibleCount: 1,
      agentDisplayName: 'Cursor',
    })

    // Assert
    expect(result.primaryLabel).toBe('Unlink from Cursor')
    expect(result.primaryAriaLabel).toBe('Unlink selected skill from Cursor')
  })

  it('shows the selected count in a non-destructive multi-skill unlink button with a generic agent label', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor' as AgentId,
      count: 4,
      visibleCount: 4,
    })

    // Assert
    expect(result.variantKey).toBe('agent-multi')
    expect(result.primaryLabel).toBe('Unlink 4 from agent')
    expect(result.isDestructive).toBe(false)
  })

  it('names the agent in the multi-skill unlink button when a display name is given', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor' as AgentId,
      count: 4,
      visibleCount: 4,
      agentDisplayName: 'Cursor',
    })

    // Assert
    expect(result.primaryLabel).toBe('Unlink 4 from Cursor')
    expect(result.primaryAriaLabel).toBe('Unlink 4 selected skills from Cursor')
  })

  it('disables the delete button when a search filter hides every selected skill in global view', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: 5, // user has 5 selected globally
      visibleCount: 0, // but search filter leaves none visible
    })

    // Assert
    expect(result.variantKey).toBe('global-zero')
    expect(result.isPrimaryDisabled).toBe(true)
    expect(result.primaryLabel).toBe('No visible skills')
    expect(result.primaryAriaLabel).toBe('No visible selected skills to delete')
  })

  it('disables the button with unlink-specific copy when no selected skill is visible in agent view', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor' as AgentId,
      count: 3,
      visibleCount: 0,
      agentDisplayName: 'Cursor',
    })

    // Assert
    expect(result.variantKey).toBe('agent-zero')
    expect(result.isPrimaryDisabled).toBe(true)
    expect(result.primaryLabel).toBe('No visible skills')
    expect(result.primaryAriaLabel).toBe(
      'No visible selected skills to unlink from Cursor',
    )
  })

  it('counts only the visible selected skills in the delete button when filters hide some rows', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: 5,
      visibleCount: 2,
    })

    // Assert
    expect(result.isPrimaryDisabled).toBe(false)
    expect(result.primaryLabel).toBe('Delete 2 skills')
    expect(result.primaryAriaLabel).toBe(
      'Move 2 visible selected skills to app trash',
    )
  })
})

describe('countOrphanSymlinksRemoved', () => {
  it('adds mid-loop partial-error commits to the orphan-cleared total', () => {
    // Arrange — one fully orphan-cleared row plus one cleanup that threw
    // mid-loop after committing unlinks (error row still carrying cascadeAgents).
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: 'abandoned',
          outcome: 'orphan-cleared',
          symlinksRemoved: 2,
          cascadeAgents: ['cursor' as AgentId],
        },
        {
          skillName: 'half-cleared',
          outcome: 'error',
          symlinksRemoved: 1,
          cascadeAgents: ['claude-code' as AgentId],
          error: { message: 'EACCES', code: 'EACCES' },
        },
      ],
    }

    // Act
    const total = countOrphanSymlinksRemoved(result)

    // Assert — 2 cleared + 1 committed-before-throw = 3.
    expect(total).toBe(3)
  })

  it('ignores deleted rows and clean errors that committed nothing', () => {
    // Arrange — a tombstoned delete (its symlinks belong to the Undo cascade,
    // not orphan cleanup) and an error row with no cascadeAgents (committed 0).
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: 'task',
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaa'),
          symlinksRemoved: 5,
          cascadeAgents: ['cursor' as AgentId],
        },
        {
          skillName: 'locked',
          outcome: 'error',
          error: { message: 'EACCES', code: 'EACCES' },
        },
      ],
    }

    // Act
    const total = countOrphanSymlinksRemoved(result)

    // Assert — neither row contributes to the orphan tally.
    expect(total).toBe(0)
  })
})

describe('formatCascadeSummary', () => {
  it('reports the deleted skill count and the total symlinks swept on a full success', () => {
    // Arrange
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

    // Act
    const summary = formatCascadeSummary(result)

    // Assert
    expect(summary).toBe('Deleted 2 skills. 3 symlinks removed.')
  })

  it('reports a partial failure as "Deleted K of N skills"', () => {
    // Arrange
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

    // Act
    const summary = formatCascadeSummary(result)

    // Assert
    expect(summary).toBe('Deleted 1 of 2 skills. 1 symlink removed.')
  })

  it('drops the symlinks sentence when a delete cascaded no symlinks', () => {
    // Arrange
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

    // Act
    const summary = formatCascadeSummary(result)

    // Assert
    expect(summary).toBe('Deleted 1 skill.')
  })

  it('uses singular "skill" and "symlink" wording when exactly one of each is removed', () => {
    // Arrange
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

    // Act
    const summary = formatCascadeSummary(result)

    // Assert
    expect(summary).toBe('Deleted 1 skill. 1 symlink removed.')
  })

  it('excludes irreversible orphan cleanup from the undoable "Deleted" count', () => {
    // Issue #71 PR-1: orphan-cleared has no tombstoneId so Undo can't restore
    // it — therefore the "Deleted N" wording must NOT include it (otherwise
    // the toast lies about how many rows the user can bring back).
    // Arrange
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

    // Act
    // 1 truly-deleted (undoable) + 2 orphan symlinks swept (irreversible) +
    // 1 cascaded symlink from the deleted row. Three independent phrases.
    const summary = formatCascadeSummary(result)

    // Assert
    expect(summary).toBe(
      'Deleted 1 skill. Cleaned up 2 orphan symlinks. 1 symlink removed.',
    )
  })

  it('omits the "Deleted" phrase entirely for an orphan-only cleanup batch', () => {
    // The all-orphan case: e.g. user deleted the source first, then bulk
    // selected the broken-symlink rows in agent view to clean them up.
    // Nothing was tombstoned, so "Deleted" stays out of the message entirely.
    // Arrange
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

    // Act
    const summary = formatCascadeSummary(result)

    // Assert
    expect(summary).toBe('Cleaned up 4 orphan symlinks.')
  })

  it('reports an orphan cleanup and a failed deletion as two standalone phrases, not a K-of-N form', () => {
    // No tombstoned rows means the K-of-N "Deleted X of Y" form has nothing
    // to attach to; the error count gets its own standalone phrase instead.
    // Arrange
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

    // Act
    const summary = formatCascadeSummary(result)

    // Assert
    expect(summary).toBe('Cleaned up 2 orphan symlinks. 1 deletion failed.')
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
  it('names the agent and the unlinked skill count when every unlink succeeds', () => {
    // Arrange
    const result: BulkUnlinkResult = {
      items: [
        { skillName: 'task', outcome: 'unlinked' },
        { skillName: 'theme', outcome: 'unlinked' },
      ],
    }

    // Act
    const summary = formatUnlinkSummary(result, 'Cursor')

    // Assert
    expect(summary).toBe('Unlinked 2 skills from Cursor.')
  })

  it('reports a partial unlink failure as "Unlinked K of N skills"', () => {
    // Arrange
    const result: BulkUnlinkResult = {
      items: [
        { skillName: 'task', outcome: 'unlinked' },
        { skillName: 'locked', outcome: 'error', error: { message: 'EACCES' } },
      ],
    }

    // Act
    const summary = formatUnlinkSummary(result, 'Cursor')

    // Assert
    expect(summary).toBe('Unlinked 1 of 2 skills from Cursor.')
  })

  it('uses singular "skill" wording when only one skill is unlinked', () => {
    // Arrange
    const result: BulkUnlinkResult = {
      items: [{ skillName: 'task', outcome: 'unlinked' }],
    }

    // Act
    const summary = formatUnlinkSummary(result, 'Cursor')

    // Assert
    expect(summary).toBe('Unlinked 1 skill from Cursor.')
  })
})

describe('computeRangeSelection', () => {
  const visible: SkillName[] = ['alpha', 'browser', 'task', 'theme', 'zebra']

  it('shift-selects every row between an earlier anchor and a later click, inclusive', () => {
    // Arrange / Act
    const range = computeRangeSelection('task', 'zebra', visible)

    // Assert
    expect(range).toEqual(['task', 'theme', 'zebra'])
  })

  it('shift-selects the same inclusive range when the anchor sits below the clicked row', () => {
    // Arrange / Act
    const range = computeRangeSelection('zebra', 'task', visible)

    // Assert
    expect(range).toEqual(['task', 'theme', 'zebra'])
  })

  it('selects just the clicked row when the anchor and target are the same row', () => {
    // Arrange / Act
    const range = computeRangeSelection('task', 'task', visible)

    // Assert
    expect(range).toEqual(['task'])
  })

  it('selects just the clicked row when there is no prior anchor', () => {
    // Arrange / Act
    const range = computeRangeSelection(null, 'task', visible)

    // Assert
    expect(range).toEqual(['task'])
  })

  it('selects just the clicked row when the anchor was filtered out by search', () => {
    // Arrange / Act
    const range = computeRangeSelection('removed-by-search', 'zebra', visible)

    // Assert
    expect(range).toEqual(['zebra'])
  })

  it('selects just the clicked row when the clicked target is not in the visible list', () => {
    // Arrange / Act
    const range = computeRangeSelection('task', 'missing', visible)

    // Assert
    expect(range).toEqual(['missing'])
  })

  it('shift-selects the whole visible list when spanning from the first row to the last', () => {
    // Arrange / Act
    const range = computeRangeSelection('alpha', 'zebra', visible)

    // Assert
    expect(range).toEqual(visible)
  })
})
