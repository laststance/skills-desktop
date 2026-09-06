import { pluralize } from '@/renderer/src/utils/pluralize'
import type {
  SkillName,
  UnprunableLockEntry,
  UnprunableReason,
} from '@/shared/types'

/**
 * The count-dependent wording the prune dialog renders, resolved once so the
 * sentence, the button and the pronoun can never disagree about how many
 * records are in play.
 */
export interface LockPruneCopy {
  /** Subject clause: what the CLI still tracks. */
  subject: string
  /** Singular or plural noun for a lock record. */
  recordNoun: string
  /** Verb agreeing with {@link LockPruneCopy.recordNoun}. */
  recordVerb: string
  /** Object pronoun for what `skills -g update` would reinstall. */
  pronoun: string
  /** Label on the destructive confirm button. */
  confirmLabel: string
}

/**
 * Resolve every count-dependent phrase in the prune dialog from one number, so
 * the copy is testable without rendering React; called on each render of
 * {@link LockPruneDialog}.
 * @param count - How many lock records the dialog is asking about.
 * @returns The wording for that count.
 * @example describeLockPruneTarget(1).confirmLabel // => 'Remove 1 record'
 * @example describeLockPruneTarget(3).subject // => '3 skills that are'
 */
export function describeLockPruneTarget(count: number): LockPruneCopy {
  const isSingular = count === 1
  return {
    subject: isSingular ? 'a skill that is' : `${count} skills that are`,
    recordNoun: pluralize(count, 'record'),
    recordVerb: isSingular ? 'is' : 'are',
    pronoun: isSingular ? 'it' : 'them',
    confirmLabel: `Remove ${count} ${pluralize(count, 'record')}`,
  }
}

/**
 * Drop the names a scan has since blocked from the list the user consented to,
 * so the prune request can never contain a record the dialog is simultaneously
 * explaining it cannot touch; called on each render of {@link LockPruneDialog}.
 *
 * Filtering only ever removes names, so the consent snapshot still holds: the
 * user can never have more deleted than they read.
 * @param consentedNames - The snapshot taken when the dialog opened.
 * @param unprunableEntries - What the newest scan reports as blocked.
 * @returns The subset still safe to send to the prune.
 * @example selectRemovableNames(['a', 'b'], [{ name: 'b', reason: 'agent-copy' }]) // => ['a']
 */
export function selectRemovableNames(
  consentedNames: readonly SkillName[],
  unprunableEntries: readonly UnprunableLockEntry[],
): SkillName[] {
  const blockedNames = new Set(unprunableEntries.map((entry) => entry.name))
  return consentedNames.filter((name) => !blockedNames.has(name))
}

/**
 * One sentence explaining why a stale record cannot be pruned, shown beside its
 * name in {@link LockPruneDialog}. Exhaustive over {@link UnprunableReason} with
 * no default arm on purpose: a new reason should fail the build here rather than
 * render a blocked record with nothing said about it.
 * @param reason - What the scan found blocking the prune.
 * @returns Plain-language explanation ending in a period.
 * @example describeUnprunableReason('agent-copy') // => 'An agent holds a real folder…'
 */
export function describeUnprunableReason(reason: UnprunableReason): string {
  switch (reason) {
    case 'name-collision':
      return 'Another lock record maps to the same folder, so removing either one could remove the wrong record.'
    case 'agent-copy':
      return 'An agent holds a real folder under this name, not a link — removing the record would delete that folder with it.'
  }
}

/**
 * Heading for the blocked-records section, agreeing with its own count.
 * Separate from {@link describeLockPruneTarget} because the two counts are
 * independent: a dialog can have three removable records and one blocked.
 * @param count - How many records are blocked.
 * @returns Heading text.
 * @example describeUnprunableSection(1) // => '1 record needs attention first'
 */
export function describeUnprunableSection(count: number): string {
  return `${count} ${pluralize(count, 'record')} ${count === 1 ? 'needs' : 'need'} attention first`
}
