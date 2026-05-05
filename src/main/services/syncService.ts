import { access, lstat, mkdir, rm, symlink } from 'fs/promises'
import { join } from 'path'

import { match, P } from 'ts-pattern'

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
} from '../../shared/types'
import { AGENTS } from '../constants'
import { extractErrorMessage } from '../utils/errors'

import { listValidSourceSkillDirs } from './dirScanner'

/** Agent-on-disk row used internally by syncPreview/syncExecute. */
type ExistingAgent = { id: AgentId; name: AgentName; path: AbsolutePath }

/**
 * Get agents whose base directory exists on disk
 * @returns Array of agents with existing directories
 */
async function getExistingAgents(): Promise<ExistingAgent[]> {
  const existing: ExistingAgent[] = []
  for (const agent of AGENTS) {
    try {
      // Check parent dir (e.g. ~/.claude) not skills dir
      const parentDir = join(agent.path, '..')
      await access(parentDir)
      existing.push(agent)
    } catch {
      // Agent directory doesn't exist
    }
  }
  return existing
}

/**
 * Narrow `getExistingAgents()` to a single agent when `options.agentId` is set.
 * Lifted out so `syncPreview` and `syncExecute` cannot drift on the filter rule.
 * Returns `[]` when the requested agent isn't on disk — preview/execute then
 * short-circuit with empty results rather than silently no-op'ing across all
 * agents (defends against typos in the agentId arg).
 */
function filterAgentsByOption<TAgent extends { id: AgentId }>(
  agents: TAgent[],
  agentId: AgentId | undefined,
): TAgent[] {
  if (!agentId) return agents
  return agents.filter((a) => a.id === agentId)
}

/**
 * Preview sync: detect what would happen without making changes.
 * Optionally scoped to a single agent for the per-agent Cleanup flow.
 * @param options - When `agentId` is set, restricts preview to that one agent.
 * @returns SyncPreviewResult with counts, conflicts, and (when scoped) `forAgent` echo.
 * @example
 * syncPreview()
 * // => { totalSkills: 5, totalAgents: 3, toCreate: 10, alreadySynced: 5, conflicts: [] }
 * @example
 * syncPreview({ agentId: 'cursor' })
 * // => { totalSkills: 5, totalAgents: 1, toCreate: 4, alreadySynced: 1, conflicts: [], forAgent: 'cursor' }
 */
export async function syncPreview(
  options?: SyncPreviewOptions,
): Promise<SyncPreviewResult> {
  const skills = await listValidSourceSkillDirs()
  const allAgents = await getExistingAgents()
  const agents = filterAgentsByOption(allAgents, options?.agentId)

  let toCreate = 0
  let alreadySynced = 0
  const conflicts: SyncConflict[] = []

  for (const skill of skills) {
    for (const agent of agents) {
      const linkPath = join(agent.path, skill.name)

      try {
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
    totalSkills: skills.length,
    totalAgents: agents.length,
    toCreate,
    alreadySynced,
    conflicts,
    ...(options?.agentId ? { forAgent: options.agentId } : {}),
  }
}

/**
 * Execute sync: create symlinks and optionally replace conflicts.
 * Tracks per-item details for displaying a sync diff after completion.
 * Optionally scoped to a single agent for the per-agent Cleanup flow.
 * @param options - replaceConflicts: paths to replace with symlinks. agentId: restrict to one agent.
 * @returns SyncExecuteResult with counts, per-item details, and errors
 * @example
 * syncExecute({ replaceConflicts: ['/Users/x/.claude/skills/my-skill'] })
 * // => { success: true, created: 10, replaced: 1, skipped: 5, errors: [], details: [...] }
 * @example
 * syncExecute({ replaceConflicts: [], agentId: 'cursor' })
 * // => { success: true, created: 4, replaced: 0, skipped: 1, errors: [], details: [...] }
 */
export async function syncExecute(
  options: SyncExecuteOptions,
): Promise<SyncExecuteResult> {
  const { replaceConflicts, agentId } = options
  const replaceSet = new Set(replaceConflicts)

  const skills = await listValidSourceSkillDirs()
  const allAgents = await getExistingAgents()
  const agents = filterAgentsByOption(allAgents, agentId)

  let created = 0
  let replaced = 0
  let skipped = 0
  const errors: SyncExecuteResult['errors'] = []
  const details: SyncResultItem[] = []
  // Track agent dirs we've already mkdir'd so per-skill loop does at most M mkdirs total,
  // while keeping the call inside the per-item try-path (errors become per-item, not global).
  const ensuredAgentDirs = new Set<string>()

  for (const skill of skills) {
    for (const agent of agents) {
      const linkPath = join(agent.path, skill.name)

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
          shouldReplace: replaceSet.has(linkPath),
        })
          .returnType<Promise<'created' | 'skipped' | 'replaced'>>()
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
          .with({ shouldReplace: true }, async () => {
            await rm(linkPath, { recursive: true, force: true })
            await symlink(skill.path, linkPath)
            replaced++
            return 'replaced' as const
          })
          .with(P._, async () => {
            // Conflict the user declined to replace. Track as skipped so the dialog
            // can show it per-item, rather than silently folding it into the aggregate.
            skipped++
            return 'skipped' as const
          })
          .exhaustive()

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
    created,
    replaced,
    skipped,
    errors,
    details,
  }
}
