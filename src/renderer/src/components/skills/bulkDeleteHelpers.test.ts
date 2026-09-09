import { describe, expect, test } from 'vitest'

import type {
  BulkDeleteResult,
  BulkUnlinkResult,
  SkillName,
} from '@/shared/types'
import {
  toSkillCount,
  toSkillName,
  toSymlinkCount,
  tombstoneId,
} from '@/shared/types'

import {
  computeRangeSelection,
  countOrphanSymlinksRemoved,
  formatCascadeSummary,
  formatUnlinkSummary,
  getToolbarState,
} from './bulkDeleteHelpers'

describe('getToolbarState', () => {
  test('offers a destructive "Delete skill" button for one skill in global view', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: toSkillCount(1),
      visibleCount: toSkillCount(1),
    })

    // Assert
    expect(result.variantKey).toBe('global-single')
    expect(result.primaryLabel).toBe('Delete skill')
    expect(result.isDestructive).toBe(true)
    expect(result.isPrimaryDisabled).toBe(false)
  })

  test('shows the selected count in the "Delete N skills" button in global view', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: toSkillCount(7),
      visibleCount: toSkillCount(7),
    })

    // Assert
    expect(result.variantKey).toBe('global-multi')
    expect(result.primaryLabel).toBe('Delete 7 skills')
    expect(result.primaryAriaLabel).toBe('Move 7 selected skills to app trash')
    expect(result.isDestructive).toBe(true)
  })

  test('offers a non-destructive unlink button with a generic agent label when the display name is unknown', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor',
      count: toSkillCount(1),
      visibleCount: toSkillCount(1),
    })

    // Assert
    expect(result.variantKey).toBe('agent-single')
    expect(result.primaryLabel).toBe('Unlink from agent')
    expect(result.isDestructive).toBe(false)
  })

  test('names the agent in the single-skill unlink button when a display name is given', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor',
      count: toSkillCount(1),
      visibleCount: toSkillCount(1),
      agentDisplayName: 'Cursor',
    })

    // Assert
    expect(result.primaryLabel).toBe('Unlink from Cursor')
    expect(result.primaryAriaLabel).toBe('Unlink selected skill from Cursor')
  })

  test('shows the selected count in a non-destructive multi-skill unlink button with a generic agent label', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor',
      count: toSkillCount(4),
      visibleCount: toSkillCount(4),
    })

    // Assert
    expect(result.variantKey).toBe('agent-multi')
    expect(result.primaryLabel).toBe('Unlink 4 from agent')
    expect(result.isDestructive).toBe(false)
  })

  test('names the agent in the multi-skill unlink button when a display name is given', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor',
      count: toSkillCount(4),
      visibleCount: toSkillCount(4),
      agentDisplayName: 'Cursor',
    })

    // Assert
    expect(result.primaryLabel).toBe('Unlink 4 from Cursor')
    expect(result.primaryAriaLabel).toBe('Unlink 4 selected skills from Cursor')
  })

  test('disables the delete button when a search filter hides every selected skill in global view', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: toSkillCount(5), // user has 5 selected globally
      visibleCount: toSkillCount(0), // but search filter leaves none visible
    })

    // Assert
    expect(result.variantKey).toBe('global-zero')
    expect(result.isPrimaryDisabled).toBe(true)
    expect(result.primaryLabel).toBe('No visible skills')
    expect(result.primaryAriaLabel).toBe('No visible selected skills to delete')
  })

  test('disables the button with unlink-specific copy when no selected skill is visible in agent view', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'agent',
      agentId: 'cursor',
      count: toSkillCount(3),
      visibleCount: toSkillCount(0),
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

  test('counts only the visible selected skills in the delete button when filters hide some rows', () => {
    // Arrange / Act
    const result = getToolbarState({
      view: 'global',
      agentId: null,
      count: toSkillCount(5),
      visibleCount: toSkillCount(2),
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
  test('adds mid-loop partial-error commits to the orphan-cleared total', () => {
    // Arrange — one fully orphan-cleared row plus one cleanup that threw
    // mid-loop after committing unlinks (error row still carrying cascadeAgents).
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: toSkillName('abandoned'),
          outcome: 'orphan-cleared',
          symlinksRemoved: toSymlinkCount(2),
          cascadeAgents: ['cursor'],
        },
        {
          skillName: toSkillName('half-cleared'),
          outcome: 'error',
          symlinksRemoved: toSymlinkCount(1),
          cascadeAgents: ['claude-code'],
          error: { message: 'EACCES', code: 'EACCES' },
        },
      ],
    }

    // Act
    const total = countOrphanSymlinksRemoved(result)

    // Assert — 2 cleared + 1 committed-before-throw = 3.
    expect(total).toBe(3)
  })

  test('ignores deleted rows and clean errors that committed nothing', () => {
    // Arrange — a tombstoned delete (its symlinks belong to the Undo cascade,
    // not orphan cleanup) and an error row with no cascadeAgents (committed 0).
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: toSkillName('task'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaa'),
          symlinksRemoved: toSymlinkCount(5),
          cascadeAgents: ['cursor'],
        },
        {
          skillName: toSkillName('locked'),
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
  test('reports the deleted skill count and the total symlinks swept on a full success', () => {
    // Arrange
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: toSkillName('task'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaa'),
          symlinksRemoved: toSymlinkCount(2),
          cascadeAgents: ['cursor', 'claude-code'],
        },
        {
          skillName: toSkillName('theme-generator'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-theme-generator-bbbb'),
          symlinksRemoved: toSymlinkCount(1),
          cascadeAgents: ['cursor'],
        },
      ],
    }

    // Act
    const summary = formatCascadeSummary(result)

    // Assert
    expect(summary).toBe('Deleted 2 skills. 3 symlinks removed.')
  })

  test('reports a partial failure as "Deleted K of N skills"', () => {
    // Arrange
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: toSkillName('task'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaa'),
          symlinksRemoved: toSymlinkCount(1),
          cascadeAgents: [],
        },
        {
          skillName: toSkillName('locked'),
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

  test('drops the symlinks sentence when a delete cascaded no symlinks', () => {
    // Arrange
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: toSkillName('task'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaa'),
          symlinksRemoved: toSymlinkCount(0),
          cascadeAgents: [],
        },
      ],
    }

    // Act
    const summary = formatCascadeSummary(result)

    // Assert
    expect(summary).toBe('Deleted 1 skill.')
  })

  test('uses singular "skill" and "symlink" wording when exactly one of each is removed', () => {
    // Arrange
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: toSkillName('task'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaa'),
          symlinksRemoved: toSymlinkCount(1),
          cascadeAgents: [],
        },
      ],
    }

    // Act
    const summary = formatCascadeSummary(result)

    // Assert
    expect(summary).toBe('Deleted 1 skill. 1 symlink removed.')
  })

  test('excludes irreversible orphan cleanup from the undoable "Deleted" count', () => {
    // Issue #71 PR-1: orphan-cleared has no tombstoneId so Undo can't restore
    // it — therefore the "Deleted N" wording must NOT include it (otherwise
    // the toast lies about how many rows the user can bring back).
    // Arrange
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: toSkillName('task'),
          outcome: 'deleted',
          tombstoneId: tombstoneId('1-task-aaaa'),
          symlinksRemoved: toSymlinkCount(1),
          cascadeAgents: ['cursor'],
        },
        {
          skillName: toSkillName('abandoned'),
          outcome: 'orphan-cleared',
          symlinksRemoved: toSymlinkCount(2),
          cascadeAgents: ['cursor', 'codex'],
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

  test('omits the "Deleted" phrase entirely for an orphan-only cleanup batch', () => {
    // The all-orphan case: e.g. user deleted the source first, then bulk
    // selected the broken-symlink rows in agent view to clean them up.
    // Nothing was tombstoned, so "Deleted" stays out of the message entirely.
    // Arrange
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: toSkillName('abandoned-a'),
          outcome: 'orphan-cleared',
          symlinksRemoved: toSymlinkCount(1),
          cascadeAgents: ['cursor'],
        },
        {
          skillName: toSkillName('abandoned-b'),
          outcome: 'orphan-cleared',
          symlinksRemoved: toSymlinkCount(3),
          cascadeAgents: ['cursor', 'codex', 'claude-code'],
        },
      ],
    }

    // Act
    const summary = formatCascadeSummary(result)

    // Assert
    expect(summary).toBe('Cleaned up 4 orphan symlinks.')
  })

  test('reports an orphan cleanup and a failed deletion as two standalone phrases, not a K-of-N form', () => {
    // No tombstoned rows means the K-of-N "Deleted X of Y" form has nothing
    // to attach to; the error count gets its own standalone phrase instead.
    // Arrange
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: toSkillName('abandoned'),
          outcome: 'orphan-cleared',
          symlinksRemoved: toSymlinkCount(2),
          cascadeAgents: ['cursor', 'codex'],
        },
        {
          skillName: toSkillName('locked'),
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

  test('counts symlinks already unlinked when a multi-agent cleanup fails partway', () => {
    // Arrange — a 3-agent orphan record where the source reappeared between
    // the 2nd and 3rd unlink: codex + cursor committed to disk, then ESTALE.
    // The error variant carries the partial cascade so the count is honest.
    const result: BulkDeleteResult = {
      items: [
        {
          skillName: toSkillName('abandoned'),
          outcome: 'error',
          error: { message: 'Source skill exists', code: 'ESTALE' },
          symlinksRemoved: toSymlinkCount(2),
          cascadeAgents: ['codex', 'cursor'],
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
  test('names the agent and the unlinked skill count when every unlink succeeds', () => {
    // Arrange
    const result: BulkUnlinkResult = {
      items: [
        { skillName: toSkillName('task'), outcome: 'unlinked' },
        { skillName: toSkillName('theme'), outcome: 'unlinked' },
      ],
    }

    // Act
    const summary = formatUnlinkSummary(result, 'Cursor')

    // Assert
    expect(summary).toBe('Unlinked 2 skills from Cursor.')
  })

  test('reports a partial unlink failure as "Unlinked K of N skills"', () => {
    // Arrange
    const result: BulkUnlinkResult = {
      items: [
        { skillName: toSkillName('task'), outcome: 'unlinked' },
        {
          skillName: toSkillName('locked'),
          outcome: 'error',
          error: { message: 'EACCES' },
        },
      ],
    }

    // Act
    const summary = formatUnlinkSummary(result, 'Cursor')

    // Assert
    expect(summary).toBe('Unlinked 1 of 2 skills from Cursor.')
  })

  test('uses singular "skill" wording when only one skill is unlinked', () => {
    // Arrange
    const result: BulkUnlinkResult = {
      items: [{ skillName: toSkillName('task'), outcome: 'unlinked' }],
    }

    // Act
    const summary = formatUnlinkSummary(result, 'Cursor')

    // Assert
    expect(summary).toBe('Unlinked 1 skill from Cursor.')
  })
})

describe('computeRangeSelection', () => {
  const visible: SkillName[] = [
    toSkillName('alpha'),
    toSkillName('browser'),
    toSkillName('task'),
    toSkillName('theme'),
    toSkillName('zebra'),
  ]

  test('shift-selects every row between an earlier anchor and a later click, inclusive', () => {
    // Arrange / Act
    const range = computeRangeSelection(
      toSkillName('task'),
      toSkillName('zebra'),
      visible,
    )

    // Assert
    expect(range).toEqual(['task', 'theme', 'zebra'])
  })

  test('shift-selects the same inclusive range when the anchor sits below the clicked row', () => {
    // Arrange / Act
    const range = computeRangeSelection(
      toSkillName('zebra'),
      toSkillName('task'),
      visible,
    )

    // Assert
    expect(range).toEqual(['task', 'theme', 'zebra'])
  })

  test('selects just the clicked row when the anchor and target are the same row', () => {
    // Arrange / Act
    const range = computeRangeSelection(
      toSkillName('task'),
      toSkillName('task'),
      visible,
    )

    // Assert
    expect(range).toEqual(['task'])
  })

  test('selects just the clicked row when there is no prior anchor', () => {
    // Arrange / Act
    const range = computeRangeSelection(null, toSkillName('task'), visible)

    // Assert
    expect(range).toEqual(['task'])
  })

  test('selects just the clicked row when the anchor was filtered out by search', () => {
    // Arrange / Act
    const range = computeRangeSelection(
      toSkillName('removed-by-search'),
      toSkillName('zebra'),
      visible,
    )

    // Assert
    expect(range).toEqual(['zebra'])
  })

  test('selects just the clicked row when the clicked target is not in the visible list', () => {
    // Arrange / Act
    const range = computeRangeSelection(
      toSkillName('task'),
      toSkillName('missing'),
      visible,
    )

    // Assert
    expect(range).toEqual(['missing'])
  })

  test('shift-selects the whole visible list when spanning from the first row to the last', () => {
    // Arrange / Act
    const range = computeRangeSelection(
      toSkillName('alpha'),
      toSkillName('zebra'),
      visible,
    )

    // Assert
    expect(range).toEqual(visible)
  })
})
