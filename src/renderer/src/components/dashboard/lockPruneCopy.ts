import { pluralize } from '@/renderer/src/utils/pluralize'

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
