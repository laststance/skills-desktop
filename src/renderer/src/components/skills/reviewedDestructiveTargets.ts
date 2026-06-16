import type {
  AbsolutePath,
  AgentId,
  BulkDeleteItemResult,
  ClearOrphanSymlinksOptions,
  Skill,
  SymlinkInfo,
} from '@/shared/types'

import type {
  DeleteSelectedSkillTarget,
  UnlinkSelectedSkillTarget,
} from '../../redux/slices/skillsSlice'

export type ReviewedOrphanCleanupRecord =
  ClearOrphanSymlinksOptions['items'][number]

export interface PartitionedGlobalDeleteTargets {
  deleteTargets: DeleteSelectedSkillTarget[]
  orphanRecords: ReviewedOrphanCleanupRecord[]
  staleDeleteErrors: BulkDeleteItemResult[]
  orphanErrors: BulkDeleteItemResult[]
  /** Skills skipped because the user has locked them — silently excluded from delete/orphan paths. */
  protectedErrors: BulkDeleteItemResult[]
}

export interface AgentUnlinkTargets {
  targets: UnlinkSelectedSkillTarget[]
  staleNames: Skill['name'][]
}

/**
 * Narrow to dangling, reviewed symlink slots that the orphan cleanup IPC can safely revalidate.
 * @param symlink - Agent slot from the reviewed renderer scan.
 * @returns true when the slot has the exact path and target cleanup requires.
 * @example isReviewedOrphanCleanupSlot(skill.symlinks[0])
 */
function isReviewedOrphanCleanupSlot(
  symlink: SymlinkInfo,
): symlink is SymlinkInfo & {
  status: 'broken'
  isLocal: false
  targetPath: AbsolutePath
} {
  return (
    symlink.status === 'broken' &&
    symlink.isLocal === false &&
    symlink.targetPath !== undefined
  )
}

/**
 * Split reviewed global delete rows into source/local deletes and orphan cleanup.
 * Protected names (locked by the user) are intercepted first and returned in
 * `protectedErrors` — they never reach the delete or orphan paths.
 * @param skills - Skill rows exactly visible when the confirmation opened.
 * @param skillNames - Display names selected for deletion.
 * @param protectedNames - Skill names the user has locked (from protectSlice).
 * @returns Reviewed targets plus stale/preflight errors and skipped protected entries.
 * @example partitionGlobalDeleteTargets(skills, ['task'], new Set(['task']))
 */
export function partitionGlobalDeleteTargets(
  skills: readonly Skill[],
  skillNames: readonly Skill['name'][],
  protectedNames: ReadonlySet<Skill['name']> = new Set(),
): PartitionedGlobalDeleteTargets {
  const skillsByName = new Map(skills.map((skill) => [skill.name, skill]))
  const deleteTargets: DeleteSelectedSkillTarget[] = []
  const orphanRecords: ReviewedOrphanCleanupRecord[] = []
  const staleDeleteErrors: BulkDeleteItemResult[] = []
  const orphanErrors: BulkDeleteItemResult[] = []
  const protectedErrors: BulkDeleteItemResult[] = []

  for (const skillName of skillNames) {
    // Protected check runs first — a locked skill is never deleted regardless of orphan status.
    if (protectedNames.has(skillName)) {
      protectedErrors.push({
        skillName,
        outcome: 'error',
        error: {
          message: 'Skill is protected. Unlock it before deleting.',
          code: 'EPROTECTED',
        },
      })
      continue
    }

    const skill = skillsByName.get(skillName)
    if (!skill?.isOrphan) {
      if (skill?.filesystemIdentity) {
        deleteTargets.push({
          skillName,
          skillPath: skill.path,
          filesystemIdentity: skill.filesystemIdentity,
        })
        continue
      }
      staleDeleteErrors.push({
        skillName,
        outcome: 'error',
        error: {
          message: 'Selected skill row is stale. Rescan before delete.',
          code: 'ESTALE',
        },
      })
      continue
    }

    const agents = skill.symlinks
      .filter(isReviewedOrphanCleanupSlot)
      .map((symlink) => ({
        agentId: symlink.agentId,
        linkPath: symlink.linkPath,
        targetPath: symlink.targetPath,
      }))

    if (agents.length > 0) {
      orphanRecords.push({ skillName, agents })
      continue
    }

    orphanErrors.push({
      skillName,
      outcome: 'error',
      error: {
        message:
          'No reviewed orphan symlink targets available. Rescan before cleanup.',
        code: 'ESTALE',
      },
    })
  }

  return {
    deleteTargets,
    orphanRecords,
    staleDeleteErrors,
    orphanErrors,
    protectedErrors,
  }
}

/**
 * Build bulk-unlink targets with the reviewed agent slot path.
 * @param skills - Current skill rows in Redux.
 * @param skillNames - Display names selected in the confirmation dialog.
 * @param agentId - Selected agent whose slots are being unlinked.
 * @returns Reviewed unlink targets plus stale rows that need a rescan.
 * @example buildAgentUnlinkTargets(skills, ['metadata-title'], 'cursor')
 */
export function buildAgentUnlinkTargets(
  skills: readonly Skill[],
  skillNames: readonly Skill['name'][],
  agentId: AgentId,
): AgentUnlinkTargets {
  const skillsByName = new Map(skills.map((skill) => [skill.name, skill]))
  const targets: UnlinkSelectedSkillTarget[] = []
  const staleNames: Skill['name'][] = []
  for (const skillName of skillNames) {
    const symlink = skillsByName
      .get(skillName)
      ?.symlinks.find((slot) => slot.agentId === agentId)
    if (symlink?.linkPath && symlink.targetPath) {
      targets.push({
        skillName,
        linkPath: symlink.linkPath,
        targetPath: symlink.targetPath,
      })
      continue
    }
    staleNames.push(skillName)
  }
  return { targets, staleNames }
}
