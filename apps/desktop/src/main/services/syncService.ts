import { access, lstat, mkdir, symlink } from 'fs/promises'
import { join } from 'path'

import { match } from 'ts-pattern'

import { AGENTS } from '@/main/constants'
import { extractErrorMessage } from '@/main/utils/errors'
import type {
  AbsolutePath,
  AgentId,
  AgentName,
  SyncConflict,
  SyncExecuteOptions,
  SyncExecuteResult,
  SyncPreviewOptions,
  SyncPreviewResult,
  SyncResultItem,
} from '@/shared/types'
import {
  toAbsolutePath,
  toAgentCount,
  toSkillCount,
  toSymlinkCount,
} from '@/shared/types'

import {
  listSourceSkillDirs,
  type SkillDirEntry,
  type SourceSkillDirListing,
} from './dirScanner'

/** Agent-on-disk row used internally by syncPreview/syncExecute. */
type ExistingAgent = { id: AgentId; name: AgentName; path: AbsolutePath }

/**
 * Resolve the one available agent requested by {@link syncPreview} or {@link syncExecute}.
 * Unknown or absent agents produce no work, so a missing scope never expands to all agents.
 * @example await getExistingAgent('cursor')
 */
async function getExistingAgent(
  agentId: AgentId,
): Promise<ExistingAgent | null> {
  const agent = AGENTS.find((candidate) => candidate.id === agentId)
  if (!agent) return null
  try {
    // Check the agent parent; recovery can create its missing skills directory.
    await access(join(agent.path, '..'))
    return agent
  } catch {
    return null
  }
}

/**
 * Pick the source skills sync is allowed to fan out, written explicitly rather than inherited from a swallowed error.
 * An unreadable source directory degrades to "sync nothing" exactly as the old
 * `catch { return [] }` did; an individual skill whose `SKILL.md` could not be
 * `stat`ed is skipped because fanning symlinks out to a directory we could not
 * even look at is a guess. A `SKILL.md` that stats fine but whose contents are
 * unreadable is still linked on purpose: the probe never reads it, and a
 * symlink stays correct once the permission bit is fixed.
 * @param listing - What {@link listSourceSkillDirs} saw under `~/.agents/skills/`.
 * @returns The entries sync may link, possibly empty.
 * @example syncableSourceSkills({ status: 'unreadable' }) // => []
 */
function syncableSourceSkills(listing: SourceSkillDirListing): SkillDirEntry[] {
  if (listing.status === 'unreadable') return []
  return listing.entries.filter((entry) => !entry.isUnreadable)
}

/**
 * Preview missing links for the agent selected in {@link CleanupAgentDialog}.
 * Existing symlinks and real-folder conflicts are counted without filesystem changes.
 * @example await syncPreview({ agentId: 'cursor' })
 */
export async function syncPreview(
  options: SyncPreviewOptions,
): Promise<SyncPreviewResult> {
  // Independent reads (source skills + on-disk agents); both helpers are total
  // (never reject), so parallelizing is behavior-identical aside from speed.
  const [listing, agent] = await Promise.all([
    listSourceSkillDirs(),
    getExistingAgent(options.agentId),
  ])
  const skills = syncableSourceSkills(listing)
  const agents = agent ? [agent] : []

  let toCreate = 0
  let alreadySynced = 0
  const conflicts: SyncConflict[] = []

  for (const skill of skills) {
    for (const agent of agents) {
      const linkPath = toAbsolutePath(join(agent.path, skill.name))

      try {
        // react-doctor-disable-next-line react-doctor/async-await-in-loop -- lstat per (skill x agent) symlink path classifying synced/conflict/missing; a bounded local-fs probe kept sequential to keep result accounting simple.
        const stats = await lstat(linkPath)

        if (stats.isSymbolicLink()) {
          alreadySynced++
        } else {
          // Real directory or file = conflict
          conflicts.push({
            skillName: skill.name,
            agentId: agent.id,
            agentName: agent.name,
            agentSkillPath: linkPath,
          })
        }
      } catch {
        // Path doesn't exist = needs creation
        toCreate++
      }
    }
  }

  return {
    totalSkills: toSkillCount(skills.length),
    totalAgents: toAgentCount(agents.length),
    toCreate: toSymlinkCount(toCreate),
    alreadySynced: toSymlinkCount(alreadySynced),
    conflicts,
    forAgent: options.agentId,
  }
}

/**
 * Recreate missing links for the agent confirmed in {@link CleanupAgentDialog}.
 * Records per-skill outcomes for {@link SyncResultDialog}; real folders are always preserved.
 * @example await syncExecute({ agentId: 'cursor' })
 */
export async function syncExecute(
  options: SyncExecuteOptions,
): Promise<SyncExecuteResult> {
  // Independent reads (source skills + on-disk agents); both helpers are total
  // (never reject), so parallelizing is behavior-identical aside from speed.
  const [listing, agent] = await Promise.all([
    listSourceSkillDirs(),
    getExistingAgent(options.agentId),
  ])
  const skills = syncableSourceSkills(listing)
  const agents = agent ? [agent] : []

  let created = 0
  let skipped = 0
  const errors: SyncExecuteResult['errors'] = []
  const details: SyncResultItem[] = []
  // Track agent dirs we've already mkdir'd so per-skill loop does at most M mkdirs total,
  // while keeping the call inside the per-item try-path (errors become per-item, not global).
  const ensuredAgentDirs = new Set<string>()

  for (const skill of skills) {
    for (const agent of agents) {
      const linkPath = toAbsolutePath(join(agent.path, skill.name))

      try {
        let exists = false
        let isSymlink = false

        try {
          const stats = await lstat(linkPath)
          exists = true
          isSymlink = stats.isSymbolicLink()
        } catch {
          // Path doesn't exist
        }

        const action = await match({
          exists,
          isSymlink,
        })
          .returnType<Promise<'created' | 'skipped'>>()
          .with({ exists: false }, async () => {
            if (!ensuredAgentDirs.has(agent.path)) {
              await mkdir(agent.path, { recursive: true })
              ensuredAgentDirs.add(agent.path)
            }
            await symlink(skill.path, linkPath)
            created++
            return 'created' as const
          })
          .with({ isSymlink: true }, async () => {
            skipped++
            return 'skipped' as const
          })
          .otherwise(async () => {
            // Real-folder conflict is always preserved. Track as skipped so the dialog
            // can show it per-item, rather than silently folding it into the aggregate.
            skipped++
            return 'skipped' as const
          })

        details.push({
          skillName: skill.name,
          agentName: agent.name,
          action,
        })
      } catch (error) {
        const msg = extractErrorMessage(error)
        errors.push({ path: linkPath, error: msg })
        details.push({
          skillName: skill.name,
          agentName: agent.name,
          action: 'error',
          error: msg,
        })
      }
    }
  }

  return {
    success: errors.length === 0,
    created: toSymlinkCount(created),
    skipped: toSymlinkCount(skipped),
    errors,
    details,
  }
}
