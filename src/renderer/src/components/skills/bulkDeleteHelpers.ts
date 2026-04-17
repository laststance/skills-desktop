import { match } from 'ts-pattern'

import type {
  AgentId,
  BulkDeleteItemResult,
  BulkDeleteResult,
  BulkUnlinkItemResult,
  BulkUnlinkResult,
  SkillName,
} from '../../../../shared/types'
import { pluralize } from '../../utils/pluralize'

/**
 * Which toolbar variant is rendering:
 *  - 'global' = no agent filter active (Installed tab, viewing all skills);
 *    the primary action is DELETE (tombstones the skill + cascades symlinks).
 *  - 'agent'  = agent filter active (user clicked a sidebar agent);
 *    the primary action is UNLINK (benign, does not touch the source dir).
 *
 * The extra `count: 1 | N` split is NOT just a pluralization concern — with
 * count=1 the button is allowed to show a single-item affordance, whereas
 * count>=2 surfaces the batch treatment (progress counter when >=10, etc.).
 */
export type ToolbarView = 'global' | 'agent'
export type ToolbarCountKind = 'single' | 'multi'

export interface ToolbarStateInput {
  view: ToolbarView
  agentId: AgentId | null
  /** Number of items currently ticked (not intersected with visible). */
  count: number
  /** Number of items currently ticked AND visible. */
  visibleCount: number
  /**
   * Human-readable agent name (e.g. "Cursor"). When provided in agent view,
   * it is embedded directly into the primary label and aria label ("Unlink
   * from Cursor"). When omitted, a generic "agent" placeholder is used.
   */
  agentDisplayName?: string
}

export interface ToolbarStateOutput {
  /** Primary button text ("Delete 3 skills", "Unlink from Cursor", etc.). */
  primaryLabel: string
  /** aria-label with the full intent spelled out for screen readers. */
  primaryAriaLabel: string
  /** True when the primary button should be disabled (no visible-and-selected items). */
  isPrimaryDisabled: boolean
  /** Destructive styling flag — renders red accent; always true for global, always false for agent. */
  isDestructive: boolean
  /** Key used to identify the four visual states during testing/debug. */
  variantKey: 'global-single' | 'global-multi' | 'agent-single' | 'agent-multi'
}

/**
 * Derive the SelectionToolbar's presentation from four inputs using a single
 * exhaustive match. Adding a future `view` or `count` bucket forces this
 * function to be updated (compile error) — the toolbar will never silently
 * fall through to a default.
 *
 * @param input - view, agentId, count, visibleCount, agentDisplayName
 * @returns ToolbarStateOutput with labels, disabled, destructive, variant key
 * @example
 * getToolbarState({ view: 'global', agentId: null, count: 3, visibleCount: 3 })
 * // => { primaryLabel: 'Delete 3 skills', isDestructive: true, variantKey: 'global-multi', ... }
 * @example
 * getToolbarState({ view: 'agent', agentId: 'cursor', count: 1, visibleCount: 1, agentDisplayName: 'Cursor' })
 * // => { primaryLabel: 'Unlink from Cursor', isDestructive: false, variantKey: 'agent-single', ... }
 */
export const getToolbarState = ({
  view,
  agentId: _agentId,
  count,
  visibleCount,
  agentDisplayName,
}: ToolbarStateInput): ToolbarStateOutput => {
  const countKind: ToolbarCountKind = count <= 1 ? 'single' : 'multi'
  const isPrimaryDisabled = visibleCount === 0
  // Fall back to "agent" when the caller doesn't know the display name yet
  // (e.g. render-before-data). Agent view is guaranteed by the match arm.
  const agentLabel = agentDisplayName ?? 'agent'

  return match({ view, countKind })
    .with({ view: 'global', countKind: 'single' }, () => ({
      primaryLabel: 'Delete skill',
      primaryAriaLabel: 'Delete selected skill permanently',
      isPrimaryDisabled,
      isDestructive: true,
      variantKey: 'global-single' as const,
    }))
    .with({ view: 'global', countKind: 'multi' }, () => ({
      primaryLabel: `Delete ${count} skills`,
      primaryAriaLabel: `Delete ${count} selected skills permanently`,
      isPrimaryDisabled,
      isDestructive: true,
      variantKey: 'global-multi' as const,
    }))
    .with({ view: 'agent', countKind: 'single' }, () => ({
      primaryLabel: `Unlink from ${agentLabel}`,
      primaryAriaLabel: `Unlink selected skill from ${agentLabel}`,
      isPrimaryDisabled,
      isDestructive: false,
      variantKey: 'agent-single' as const,
    }))
    .with({ view: 'agent', countKind: 'multi' }, () => ({
      primaryLabel: `Unlink ${count} from ${agentLabel}`,
      primaryAriaLabel: `Unlink ${count} selected skills from ${agentLabel}`,
      isPrimaryDisabled,
      isDestructive: false,
      variantKey: 'agent-multi' as const,
    }))
    .exhaustive()
}

/**
 * Build the summary string shown in the undo toast after a bulk DELETE:
 *  - Counts successful deletes vs errors.
 *  - Aggregates `symlinksRemoved` across every success to surface the cascade.
 *
 * @param result - BulkDeleteResult from the main-process thunk.
 * @returns Human-readable summary for the toast body.
 * @example
 * formatCascadeSummary({ items: [
 *   { skillName: 'task', outcome: 'deleted', tombstoneId: '...', symlinksRemoved: 2, cascadeAgents: ['cursor', 'claude-code'] },
 *   { skillName: 'theme', outcome: 'deleted', tombstoneId: '...', symlinksRemoved: 1, cascadeAgents: ['cursor'] },
 * ] })
 * // => 'Deleted 2 skills. 3 symlinks removed.'
 * @example
 * // With errors:
 * formatCascadeSummary({ items: [
 *   { skillName: 'task', outcome: 'deleted', tombstoneId: '...', symlinksRemoved: 1, cascadeAgents: [] },
 *   { skillName: 'locked', outcome: 'error', error: { message: 'EACCES' } },
 * ] })
 * // => 'Deleted 1 of 2 skills. 1 symlink removed.'
 */
export const formatCascadeSummary = (result: BulkDeleteResult): string => {
  const deletedItems = result.items.filter(
    (item): item is Extract<BulkDeleteItemResult, { outcome: 'deleted' }> =>
      item.outcome === 'deleted',
  )
  const totalSymlinksRemoved = deletedItems.reduce(
    (sum, item) => sum + item.symlinksRemoved,
    0,
  )
  const deletedCount = deletedItems.length
  const totalCount = result.items.length
  const hadErrors = deletedCount < totalCount

  const skillsPhrase = hadErrors
    ? `Deleted ${deletedCount} of ${totalCount} ${pluralize(totalCount, 'skill')}.`
    : `Deleted ${deletedCount} ${pluralize(deletedCount, 'skill')}.`

  // Omit the symlink sentence when nothing cascaded (keeps the toast compact).
  const symlinksPhrase =
    totalSymlinksRemoved > 0
      ? ` ${totalSymlinksRemoved} ${pluralize(totalSymlinksRemoved, 'symlink')} removed.`
      : ''

  return `${skillsPhrase}${symlinksPhrase}`
}

/**
 * Build the summary string for a bulk UNLINK result (no cascade tracking since
 * unlink is a single-agent op with no tombstone).
 *
 * @param result - BulkUnlinkResult
 * @param agentDisplayName - Name of the agent (e.g. "Cursor")
 * @returns Summary text
 * @example
 * formatUnlinkSummary({ items: [{ skillName: 'task', outcome: 'unlinked' }] }, 'Cursor')
 * // => 'Unlinked 1 skill from Cursor.'
 */
export const formatUnlinkSummary = (
  result: BulkUnlinkResult,
  agentDisplayName: string,
): string => {
  const unlinkedItems = result.items.filter(
    (item): item is Extract<BulkUnlinkItemResult, { outcome: 'unlinked' }> =>
      item.outcome === 'unlinked',
  )
  const unlinkedCount = unlinkedItems.length
  const totalCount = result.items.length
  const hadErrors = unlinkedCount < totalCount

  return hadErrors
    ? `Unlinked ${unlinkedCount} of ${totalCount} ${pluralize(totalCount, 'skill')} from ${agentDisplayName}.`
    : `Unlinked ${unlinkedCount} ${pluralize(unlinkedCount, 'skill')} from ${agentDisplayName}.`
}

/**
 * Given an anchor row and a target row, return the ordered slice of names
 * between them (inclusive). Used by Shift+click range selection.
 *
 *  - Finds both anchor and target inside `visibleOrdered` (the currently
 *    filtered+sorted list).
 *  - If either is missing (e.g. the anchor was filtered out), falls back to
 *    just `[targetName]`. This mirrors macOS Finder behavior — shift-click on
 *    a fresh list without an anchor selects only the clicked row.
 *  - Returns names in visible order regardless of which was clicked first
 *    (so a shift-click above the anchor yields the same array as below).
 *
 * @param anchorName - Previous single-click target (may be null on first shift-click).
 * @param targetName - Just-clicked target.
 * @param visibleOrdered - Names in display order (selectFilteredSkills().map(s => s.name)).
 * @returns Names to add to the selection, in visible order. Never empty.
 * @example
 * computeRangeSelection('task', 'zebra', ['alpha','browser','task','theme','zebra'])
 * // => ['task','theme','zebra']
 * @example
 * // Anchor filtered out:
 * computeRangeSelection('removed', 'zebra', ['alpha','zebra'])
 * // => ['zebra']
 */
export const computeRangeSelection = (
  anchorName: SkillName | null,
  targetName: SkillName,
  visibleOrdered: SkillName[],
): SkillName[] => {
  const targetIndex = visibleOrdered.indexOf(targetName)
  // Target not in visible list — should not happen in practice (the target was
  // just clicked) but guard the return type: no range is possible.
  if (targetIndex === -1) return [targetName]

  const anchorIndex =
    anchorName === null ? -1 : visibleOrdered.indexOf(anchorName)
  if (anchorIndex === -1) return [targetName]

  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return visibleOrdered.slice(start, end + 1)
}
