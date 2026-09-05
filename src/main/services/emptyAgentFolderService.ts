import { randomUUID } from 'node:crypto'
import { lstat, readdir, realpath, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'

import { shell } from 'electron'

import { AGENTS, SOURCE_DIR, findAgentById } from '@/main/constants'
import { errorCode } from '@/main/utils/errorCode'
import { extractErrorMessage } from '@/main/utils/errors'
import { restoreQuarantinedPath } from '@/main/utils/restoreQuarantinedPath'
import type {
  Agent,
  EmptyAgentFolder,
  RemoveEmptyAgentFolderOptions,
  RemoveEmptyAgentFolderResult,
} from '@/shared/types'

import {
  filesystemIdentityFromStats,
  isReviewedEntryUnchangedIdentity,
  isSameFilesystemIdentity,
} from './filesystemIdentity'

/**
 * Finds a dedicated empty parent when the scanner or deletion handler reviews a not-installed agent.
 * @param agent - Registered agent whose skills directory is absent.
 * @returns Reviewed empty parent, or undefined for missing, shared, aliased, or nonempty folders.
 * @example await getEmptyAgentFolder(cline) // { path: '/Users/me/.cline', filesystemIdentity: ... }
 */
export async function getEmptyAgentFolder(
  agent: Pick<Agent, 'id' | 'path'>,
): Promise<EmptyAgentFolder | undefined> {
  const folderPath = dirname(agent.path)
  const otherFolders = [
    dirname(SOURCE_DIR),
    ...AGENTS.filter((candidate) => candidate.id !== agent.id).map(
      (candidate) => dirname(candidate.path),
    ),
  ]
  // A shared root or an ancestor of another agent/source is never an individual cleanup target.
  if (
    otherFolders.some(
      (otherPath) =>
        otherPath === folderPath || otherPath.startsWith(`${folderPath}/`),
    )
  ) {
    return undefined
  }

  try {
    const stats = await lstat(folderPath)
    if (!stats.isDirectory() || stats.isSymbolicLink()) return undefined
    // Reject symlinked ancestors as well as direct aliases; allow the OS's canonical HOME path.
    const canonicalHome = await realpath(homedir())
    if (
      (await realpath(folderPath)) !==
      join(canonicalHome, relative(homedir(), folderPath))
    ) {
      return undefined
    }
    if ((await readdir(folderPath)).length > 0) return undefined
    return {
      path: folderPath,
      filesystemIdentity: filesystemIdentityFromStats(stats),
    }
  } catch {
    // Unreadable or missing folders cannot be proven empty and stay out of the review.
    return undefined
  }
}

/**
 * Trashes only the reviewed empty parent when the not-installed agent confirmation submits.
 * @param options - Agent id and empty-folder identity captured by the scanner.
 * @returns Actual removal, an already-missing no-op, or a recoverable failure explanation.
 * @example await removeEmptyAgentFolder({ agentId: 'cline', ...reviewedFolder })
 */
export async function removeEmptyAgentFolder(
  options: RemoveEmptyAgentFolderOptions,
): Promise<RemoveEmptyAgentFolderResult> {
  let stagedPath: string | undefined
  try {
    const agent = findAgentById(options.agentId)
    if (!agent || dirname(agent.path) !== options.path) {
      throw new Error('Agent folder does not match the reviewed path.')
    }
    // ENOENT is a no-op; permission failures must remain visible instead of looking successful.
    try {
      await lstat(options.path)
    } catch (error) {
      if (errorCode(error) === 'ENOENT')
        return { success: true, deleted: false }
      throw error
    }
    const currentFolder = await getEmptyAgentFolder(agent)
    if (
      !currentFolder ||
      !isReviewedEntryUnchangedIdentity(
        currentFolder.filesystemIdentity,
        options.filesystemIdentity,
      )
    ) {
      throw new Error(
        'Agent folder is no longer empty or changed since review. Rescan before deleting.',
      )
    }

    // Quarantine the reviewed object so a replacement at the original path cannot be trashed.
    const quarantinePath = `${options.path}.cleanup-${randomUUID()}`
    await rename(options.path, quarantinePath)
    stagedPath = quarantinePath
    const stagedStats = await lstat(quarantinePath)
    if (
      !stagedStats.isDirectory() ||
      !isSameFilesystemIdentity(stagedStats, options.filesystemIdentity) ||
      (await readdir(quarantinePath)).length > 0
    ) {
      throw new Error(
        'Agent folder is no longer empty or changed during deletion.',
      )
    }
    await shell.trashItem(quarantinePath)
    return { success: true, deleted: true }
  } catch (error) {
    if (stagedPath) {
      // Share the existing restore guards so failures preserve replacements and report recovery paths.
      if (!(await restoreQuarantinedPath(stagedPath, options.path))) {
        return {
          success: false,
          error: `${extractErrorMessage(error)} Folder kept at ${stagedPath}.`,
        }
      }
    }
    return { success: false, error: extractErrorMessage(error) }
  }
}
