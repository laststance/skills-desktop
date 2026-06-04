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
 * @returns
 * - every target copied → `success`, lists the copied skill names so each is recognizable later
 * - nothing copied at all → `error`, lists the failures
 * - mixed → `warning`, reports the fully-copied count and the per-target failures
 * @example
 * summarizeBulkCopyResult([{ skillName: 'a', copied: 2, failures: [] }])
 * // => { tone: 'success', title: 'Copied 1 skill to 2 agents', description: 'a' }
 * @example
 * summarizeBulkCopyResult([{ skillName: 'a', copied: 1, failures: [{ agentId: 'codex', error: 'Already exists' }] }])
 * // => { tone: 'warning', title: 'Copied 0 of 1 skill, 1 copy failed', description: 'a → codex: Already exists' }
 */
export function summarizeBulkCopyResult(
  perSkill: BulkCopyToAgentsResult['perSkill'],
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
  const skillWord = skillCount === 1 ? 'skill' : 'skills'
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
    const copyWord = failureCount === 1 ? 'copy' : 'copies'
    const fullySucceeded = perSkill.filter(
      (outcome) => outcome.failures.length === 0,
    ).length
    return {
      tone: 'warning',
      title: `Copied ${fullySucceeded} of ${skillCount} ${skillWord}, ${failureCount} ${copyWord} failed`,
      description: failureLines.join(', '),
    }
  }

  // Every selected skill copied to every chosen agent. With zero failures each
  // skill targeted the same agents, so any outcome's `copied` is the agent count.
  const agentsPerSkill = perSkill[0].copied
  const agentWord = agentsPerSkill === 1 ? 'agent' : 'agents'
  return {
    tone: 'success',
    title: `Copied ${skillCount} ${skillWord} to ${agentsPerSkill} ${agentWord}`,
    description: perSkill.map((outcome) => outcome.skillName).join(', '),
  }
}
