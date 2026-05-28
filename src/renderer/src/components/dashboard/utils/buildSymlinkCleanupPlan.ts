import type {
  AbsolutePath,
  AgentId,
  AgentName,
  IsoTimestamp,
  Skill,
  SkillName,
  SymlinkInfo,
} from '@/shared/types'

export type SymlinkCleanupItemId = string

export interface OrphanCleanupPlanItem {
  id: SymlinkCleanupItemId
  kind: 'orphan-record'
  skillName: SkillName
  agents: Array<{
    agentId: AgentId
    agentName: AgentName
    linkPath: AbsolutePath
  }>
  symlinkCount: number
}

export interface BrokenSlotCleanupPlanItem {
  id: SymlinkCleanupItemId
  kind: 'broken-slot'
  displaySkillName: SkillName
  linkName: SkillName
  preservedSkillPath: AbsolutePath
  agentId: AgentId
  agentName: AgentName
  linkPath: AbsolutePath
  targetPath: AbsolutePath
}

export type SymlinkCleanupPlanItem =
  | OrphanCleanupPlanItem
  | BrokenSlotCleanupPlanItem

export interface SymlinkCleanupPlan {
  generatedAt: IsoTimestamp
  orphanRecords: OrphanCleanupPlanItem[]
  brokenSlotsByAgent: Partial<Record<AgentId, BrokenSlotCleanupPlanItem[]>>
  totals: {
    orphanRecords: number
    orphanSymlinks: number
    brokenSlots: number
    affectedAgents: number
  }
}

/**
 * Builds a stable id segment for cleanup row selection when scan results drive dialog checkboxes.
 * @param value - Raw skill, agent, or link name segment.
 * @returns URI-escaped segment safe to join with `:`.
 * @example
 * encodeCleanupIdSegment('agent:skill') // => 'agent%3Askill'
 */
function encodeCleanupIdSegment(value: string): string {
  return encodeURIComponent(value)
}

/**
 * Builds an orphan cleanup row id from the skill name when the review list renders.
 * @param skillName - Skill whose only remaining records are orphan symlinks.
 * @returns Stable orphan row id.
 * @example
 * createOrphanCleanupItemId('abandoned') // => 'orphan:abandoned'
 */
export function createOrphanCleanupItemId(
  skillName: SkillName,
): SymlinkCleanupItemId {
  return `orphan:${encodeCleanupIdSegment(skillName)}`
}

/**
 * Builds a broken-slot cleanup row id from the agent and link name when rows need independent selection.
 * @param agentId - Agent that owns the dangling symlink slot.
 * @param linkName - Agent-side symlink basename used by unlink IPC.
 * @returns Stable broken-slot row id.
 * @example
 * createBrokenSlotCleanupItemId('cursor', 'agent:skill') // => 'broken:cursor:agent%3Askill'
 */
export function createBrokenSlotCleanupItemId(
  agentId: AgentId,
  linkName: SkillName,
): SymlinkCleanupItemId {
  return `broken:${encodeCleanupIdSegment(agentId)}:${encodeCleanupIdSegment(linkName)}`
}

/**
 * Extracts the final path segment from a symlink link path so unlink targets the agent-side name.
 * @param linkPath - Absolute path to the symlink inside an agent skills directory.
 * @returns Last path segment, or the full path when no separator is present.
 * @example
 * getLinkNameFromPath('/Users/me/.cursor/skills/task') // => 'task'
 */
export function getLinkNameFromPath(linkPath: AbsolutePath): SkillName {
  const normalizedPath = linkPath.replaceAll('\\', '/')
  const pathSegments = normalizedPath.split('/').filter(Boolean)
  return pathSegments[pathSegments.length - 1] ?? normalizedPath
}

/**
 * Returns true when the slot is a broken non-local symlink the cleanup flow may remove.
 * @param symlink - Per-agent slot from a scanned Skill record.
 * @returns Whether the slot is eligible for symlink cleanup.
 * @example
 * isCleanupEligibleBrokenSlot({ status: 'broken', isLocal: false, ...slot }) // => true
 */
function isCleanupEligibleBrokenSlot(
  symlink: SymlinkInfo,
): symlink is SymlinkInfo & {
  status: 'broken'
  isLocal: false
  targetPath: AbsolutePath
} {
  return (
    symlink.status === 'broken' &&
    !symlink.isLocal &&
    typeof symlink.targetPath === 'string'
  )
}

/**
 * Flattens a cleanup plan into review rows for selection, validation, and execution.
 * @param plan - Cleanup plan returned by `buildSymlinkCleanupPlan`.
 * @returns Orphan rows followed by broken-slot rows grouped by agent.
 * @example
 * getSymlinkCleanupPlanItems(plan).map((item) => item.id)
 */
export function getSymlinkCleanupPlanItems(
  plan: SymlinkCleanupPlan,
): SymlinkCleanupPlanItem[] {
  return [
    ...plan.orphanRecords,
    ...Object.values(plan.brokenSlotsByAgent).flatMap((items) => items ?? []),
  ]
}

/**
 * Builds the Symlink Health cleanup plan from a fresh scanner snapshot before review or stale checks.
 * @param skills - Fresh Skill[] returned by `fetchSkills().unwrap()`.
 * @returns Renderer-only cleanup plan separating orphan records from broken agent slots.
 * @example
 * buildSymlinkCleanupPlan([{ name: 'task', isOrphan: true, symlinks: [brokenSlot], ...rest }])
 */
export function buildSymlinkCleanupPlan(
  skills: readonly Skill[],
): SymlinkCleanupPlan {
  const orphanRecords: OrphanCleanupPlanItem[] = []
  const brokenSlotsByAgent: Partial<
    Record<AgentId, BrokenSlotCleanupPlanItem[]>
  > = {}
  const affectedAgentIds = new Set<AgentId>()

  for (const skill of skills) {
    const cleanupEligibleBrokenSlots = skill.symlinks.filter(
      isCleanupEligibleBrokenSlot,
    )
    if (cleanupEligibleBrokenSlots.length === 0) continue

    if (skill.isOrphan) {
      orphanRecords.push({
        id: createOrphanCleanupItemId(skill.name),
        kind: 'orphan-record',
        skillName: skill.name,
        agents: cleanupEligibleBrokenSlots.map((symlink) => ({
          agentId: symlink.agentId,
          agentName: symlink.agentName,
          linkPath: symlink.linkPath,
        })),
        symlinkCount: cleanupEligibleBrokenSlots.length,
      })
      for (const symlink of cleanupEligibleBrokenSlots) {
        affectedAgentIds.add(symlink.agentId)
      }
      continue
    }

    for (const symlink of cleanupEligibleBrokenSlots) {
      const linkName = getLinkNameFromPath(symlink.linkPath)
      const planItem: BrokenSlotCleanupPlanItem = {
        id: createBrokenSlotCleanupItemId(symlink.agentId, linkName),
        kind: 'broken-slot',
        displaySkillName: skill.name,
        linkName,
        preservedSkillPath: skill.path,
        agentId: symlink.agentId,
        agentName: symlink.agentName,
        linkPath: symlink.linkPath,
        targetPath: symlink.targetPath,
      }
      brokenSlotsByAgent[symlink.agentId] = [
        ...(brokenSlotsByAgent[symlink.agentId] ?? []),
        planItem,
      ]
      affectedAgentIds.add(symlink.agentId)
    }
  }

  const brokenSlots = Object.values(brokenSlotsByAgent).reduce(
    (total, items) => total + (items?.length ?? 0),
    0,
  )

  return {
    generatedAt: new Date().toISOString(),
    orphanRecords,
    brokenSlotsByAgent,
    totals: {
      orphanRecords: orphanRecords.length,
      orphanSymlinks: orphanRecords.reduce(
        (total, item) => total + item.symlinkCount,
        0,
      ),
      brokenSlots,
      affectedAgents: affectedAgentIds.size,
    },
  }
}
