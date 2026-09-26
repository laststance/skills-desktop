import { pluralize } from '@/renderer/src/utils/pluralize'
import type { BulkCopyToAgentsResult } from '@/shared/types'

/** Sonner toast severity for a bulk copy outcome. */
export type BulkCopyToastTone = 'success' | 'warning' | 'error'

/** Title + description + severity for the single toast shown after a bulk copy. */
export interface BulkCopyToastContent {
  tone: BulkCopyToastTone
  title: string
  description: string
}

/**
 * Collapse a bulk copy-to-agents result into ONE user-facing toast.
 *
 * Exists so `BulkCopyToAgentsModal` fires a single toast (not one per skill)
 * after the renderer fan-out completes, and so the success / partial / failure
 * wording stays unit-testable in isolation. Triggered on `bulkCopyToAgents`
 * fulfilment.
 *
 * @param perSkill - one outcome per selected skill (`BulkCopyToAgentsResult.perSkill`)
 * @param targetAgentCount - how many agents the user ticked; the authoritative
 *   denominator for the success title, sourced from the modal's checked agents
 *   rather than inferred from any single skill's `copied`
 * @returns
 * - every target copied → `success`, lists the copied skill names so each is recognizable later
 * - nothing copied at all → `error`, lists the failures
 * - mixed → `warning`, reports the fully-copied count and the per-target failures
 * @example
 * summarizeBulkCopyResult([{ skillName: 'a', copied: 2, failures: [] }], 2)
 * // => { tone: 'success', title: 'Copied 1 skill to 2 agents', description: 'a' }
 * @example
 * summarizeBulkCopyResult([{ skillName: 'a', copied: 1, failures: [{ agentId: 'codex', error: 'Already exists' }] }], 2)
 * // => { tone: 'warning', title: 'Copied 0 of 1 skill, 1 copy failed', description: 'a → codex: Already exists' }
 */
export function summarizeBulkCopyResult(
  perSkill: BulkCopyToAgentsResult['perSkill'],
  targetAgentCount: number,
): BulkCopyToastContent {
  // Defensive: callers guard against this, but never fabricate a "success".
  if (perSkill.length === 0) {
    return {
      tone: 'error',
      title: 'Nothing to copy',
      description: 'No skills were selected.',
    }
  }

  const skillCount = perSkill.length
  const skillWord = pluralize(skillCount, 'skill')
  const totalCopied = perSkill.reduce((sum, outcome) => sum + outcome.copied, 0)
  const failureLines = perSkill.flatMap((outcome) =>
    outcome.failures.map(
      (failure) =>
        `${outcome.skillName} → ${failure.agentId}: ${failure.error}`,
    ),
  )
  const failureCount = failureLines.length

  // Nothing landed anywhere — surface as a hard failure.
  if (totalCopied === 0) {
    return {
      tone: 'error',
      title: `Failed to copy ${skillCount} ${skillWord}`,
      description: failureLines.join(', ') || 'An unexpected error occurred',
    }
  }

  // Some targets rejected (e.g. destination already exists) — partial success.
  if (failureCount > 0) {
    const copyWord = pluralize(failureCount, 'copy', 'copies')
    const fullySucceeded = perSkill.filter(
      (outcome) => outcome.failures.length === 0,
    ).length
    return {
      tone: 'warning',
      title: `Copied ${fullySucceeded} of ${skillCount} ${skillWord}, ${failureCount} ${copyWord} failed`,
      description: failureLines.join(', '),
    }
  }

  // Every selected skill copied to every chosen agent. Use the authoritative
  // ticked-agent count for the title rather than inferring it from a skill's
  // `copied`, so the wording can't drift if the IPC contract ever changes.
  const agentWord = pluralize(targetAgentCount, 'agent')
  return {
    tone: 'success',
    title: `Copied ${skillCount} ${skillWord} to ${targetAgentCount} ${agentWord}`,
    description: perSkill.map((outcome) => outcome.skillName).join(', '),
  }
}
