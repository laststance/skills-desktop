import { match } from 'ts-pattern'

import { pluralize } from '@/renderer/src/utils/pluralize'
import type {
  AgentId,
  BulkDeleteItemResult,
  BulkDeleteResult,
  BulkUnlinkItemResult,
  BulkUnlinkResult,
  SkillName,
} from '@/shared/types'

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
type ToolbarCountKind = 'single' | 'multi'

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
  // The primary button acts only on selected rows that survived the current
  // filter, while the adjacent selection summary owns the total hidden count.
  const actionCount = visibleCount
  const countKind: ToolbarCountKind = actionCount <= 1 ? 'single' : 'multi'
  const isPrimaryDisabled = visibleCount === 0
  const ariaSelectionScope =
    count === visibleCount ? 'selected' : 'visible selected'
  // Fall back to "agent" when the caller doesn't know the display name yet
  // (e.g. render-before-data). Agent view is guaranteed by the match arm.
  const agentLabel = agentDisplayName ?? 'agent'

  return match({ view, countKind })
    .with({ view: 'global', countKind: 'single' }, () => ({
      primaryLabel: 'Delete skill',
      primaryAriaLabel: `Delete ${ariaSelectionScope} skill permanently`,
      isPrimaryDisabled,
      isDestructive: true,
      variantKey: 'global-single' as const,
    }))
    .with({ view: 'global', countKind: 'multi' }, () => ({
      primaryLabel: `Delete ${actionCount} skills`,
      primaryAriaLabel: `Delete ${actionCount} ${ariaSelectionScope} skills permanently`,
      isPrimaryDisabled,
      isDestructive: true,
      variantKey: 'global-multi' as const,
    }))
    .with({ view: 'agent', countKind: 'single' }, () => ({
      primaryLabel: `Unlink from ${agentLabel}`,
      primaryAriaLabel: `Unlink ${ariaSelectionScope} skill from ${agentLabel}`,
      isPrimaryDisabled,
      isDestructive: false,
      variantKey: 'agent-single' as const,
    }))
    .with({ view: 'agent', countKind: 'multi' }, () => ({
      primaryLabel: `Unlink ${actionCount} from ${agentLabel}`,
      primaryAriaLabel: `Unlink ${actionCount} ${ariaSelectionScope} skills from ${agentLabel}`,
      isPrimaryDisabled,
      isDestructive: false,
      variantKey: 'agent-multi' as const,
    }))
    .exhaustive()
}

/**
 * Build the summary string shown in the toast body after a bulk DELETE.
 *
 * The phrases are deliberately independent so the Undo-facing text only
 * counts truly restorable rows (`outcome === 'deleted'`):
 *
 *  1. **"Deleted N skill(s)"** — tombstoned only. Drives the Undo wording in
 *     `MainContent`'s undo toast; orphan-cleared rows MUST NOT be folded in
 *     here, otherwise Undo lies about how many things will come back.
 *  2. **"Cleaned up M orphan symlinks"** — orphan-cleared rows. Communicated
 *     as a distinct phrase because there is no undo path; the user should see
 *     it as a separate, irreversible cleanup.
 *  3. **"X symlinks removed"** — cascade tally from tombstoned rows ONLY.
 *     Orphan symlinks are already counted by phrase 2; combining them would
 *     double-count.
 *  4. **"Y deletion(s) failed"** — emitted only when there are errors AND no
 *     tombstoned rows to embed the K-of-N form into.
 *
 * @param result - BulkDeleteResult from the main-process thunk.
 * @returns Human-readable summary built from the four phrases above.
 * @example
 * formatCascadeSummary({ items: [
 *   { skillName: 'task', outcome: 'deleted', tombstoneId: '...', symlinksRemoved: 2, cascadeAgents: ['cursor', 'claude-code'] },
 *   { skillName: 'theme', outcome: 'deleted', tombstoneId: '...', symlinksRemoved: 1, cascadeAgents: ['cursor'] },
 * ] })
 * // => 'Deleted 2 skills. 3 symlinks removed.'
 * @example
 * // Mixed deleted + orphan-cleared — orphan stays separate from the Undo count:
 * formatCascadeSummary({ items: [
 *   { skillName: 'task', outcome: 'deleted', tombstoneId: '...', symlinksRemoved: 1, cascadeAgents: [] },
 *   { skillName: 'abandoned', outcome: 'orphan-cleared', symlinksRemoved: 2, cascadeAgents: ['cursor', 'codex'] },
 * ] })
 * // => 'Deleted 1 skill. Cleaned up 2 orphan symlinks. 1 symlink removed.'
 * @example
 * // With errors:
 * formatCascadeSummary({ items: [
 *   { skillName: 'task', outcome: 'deleted', tombstoneId: '...', symlinksRemoved: 1, cascadeAgents: [] },
 *   { skillName: 'locked', outcome: 'error', error: { message: 'EACCES', code: 'EACCES' } },
 * ] })
 * // => 'Deleted 1 of 2 skills. 1 symlink removed.'
 */
export const formatCascadeSummary = (result: BulkDeleteResult): string => {
  const deletedItems = result.items.filter(
    (item): item is Extract<BulkDeleteItemResult, { outcome: 'deleted' }> =>
      item.outcome === 'deleted',
  )
  const orphanItems = result.items.filter(
    (
      item,
    ): item is Extract<BulkDeleteItemResult, { outcome: 'orphan-cleared' }> =>
      item.outcome === 'orphan-cleared',
  )
  const errorCount = result.items.filter(
    (item) => item.outcome === 'error',
  ).length

  const deletedCount = deletedItems.length
  const tombstonedAttempted = deletedCount + errorCount
  const tombstonedCascade = deletedItems.reduce(
    (sum, item) => sum + item.symlinksRemoved,
    0,
  )
  const orphanSymlinks = orphanItems.reduce(
    (sum, item) => sum + item.symlinksRemoved,
    0,
  )

  const phrases: string[] = []

  // Phrase 1 — tombstoned only. The Undo button restores exactly these rows.
  if (deletedCount > 0) {
    phrases.push(
      errorCount > 0
        ? `Deleted ${deletedCount} of ${tombstonedAttempted} ${pluralize(tombstonedAttempted, 'skill')}.`
        : `Deleted ${deletedCount} ${pluralize(deletedCount, 'skill')}.`,
    )
  }

  // Phrase 2 — orphan cleanup, irreversible, kept distinct from deletions.
  if (orphanSymlinks > 0) {
    phrases.push(
      `Cleaned up ${orphanSymlinks} orphan ${pluralize(orphanSymlinks, 'symlink')}.`,
    )
  }

  // Phrase 3 — cascade tally from tombstoned only (orphans counted in phrase 2).
  if (tombstonedCascade > 0) {
    phrases.push(
      `${tombstonedCascade} ${pluralize(tombstonedCascade, 'symlink')} removed.`,
    )
  }

  // Phrase 4 — standalone error report when no tombstoned row absorbs it.
  if (deletedCount === 0 && errorCount > 0) {
    phrases.push(`${errorCount} ${pluralize(errorCount, 'deletion')} failed.`)
  }

  return phrases.join(' ')
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
