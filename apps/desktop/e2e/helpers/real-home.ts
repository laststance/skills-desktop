import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'

import type { ElectronApplication } from '@playwright/test'

import { AGENT_DEFINITIONS } from '@/shared/constants'

import { launchIsolatedElectron } from '../fixtures/electron-app'

import {
  entryKind,
  lockHasSkill,
  readSkillLock,
  snapshotProtectedDirectory,
  trashEntriesForSkill,
  type ProtectedDirectorySnapshot,
} from './filesystem-truth'

/**
 * Resolve symlinks in the deepest existing ancestor, then reattach missing suffixes.
 * Exists because preflight must detect aliases before the azure-ai child exists.
 * @param path - Absolute path being checked.
 * @returns Canonical path even when the leaf does not exist yet.
 * @example canonicalPathEvenIfMissing('/home/user/.config/goose/skills')
 */
async function canonicalPathEvenIfMissing(path: string): Promise<string> {
  const missingSegments: string[] = []
  let current = path
  for (;;) {
    try {
      return join(await realpath(current), ...missingSegments)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
      missingSegments.unshift(basename(current))
      const parent = dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

/**
 * Check whether a canonical child path is a protected directory or inside it.
 * @param child - Canonical candidate path.
 * @param parent - Canonical protected directory.
 * @returns True when writing the child can affect the protected tree.
 * @example isSameOrInside('/home/user/.claude/skills/x', '/home/user/.claude/skills')
 */
function isSameOrInside(child: string, parent: string): boolean {
  const relativePath = relative(parent, child)
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

export interface ProtectedSnapshots {
  claude: ProtectedDirectorySnapshot
  cursor: ProtectedDirectorySnapshot
}

export interface RealHomePreflight {
  ok: boolean
  reasons: string[]
  lockPath: string
  gooseSkillsDir: string
  protectedSnapshots: ProtectedSnapshots
}

export interface RealHomeLaunchContext {
  userDataDir: string
  emptyPathDir: string
  cleanup: () => Promise<void>
}

/**
 * Resolve the lock path the skills manager will use for this launch.
 * Exists because the upstream contract honors `XDG_STATE_HOME` when the host
 * sets it and falls back to `~/.agents` otherwise.
 * @param home - Real host home directory.
 * @returns Absolute lock path visible to the launched app.
 * @example realSkillLockPath('/home/user')
 */
export function realSkillLockPath(home: string): string {
  return process.env['XDG_STATE_HOME']
    ? join(process.env['XDG_STATE_HOME'], 'skills', '.skill-lock.json')
    : join(home, '.agents', '.skill-lock.json')
}

/**
 * Run every ownership and protection check before a real-HOME mutation.
 * Exists to make the lane fail closed: ambiguous preexisting azure-ai state is
 * a skip, never an invitation to delete user data.
 * @param home - Real host home directory.
 * @returns Skip reasons plus paths/snapshots needed by the spec.
 * @example await preflightRealHome(process.env.HOME!)
 */
export async function preflightRealHome(
  home: string,
): Promise<RealHomePreflight> {
  const reasons: string[] = []
  const sourceSkillsDir = join(home, '.agents', 'skills')
  const sourceAzure = join(sourceSkillsDir, 'azure-ai')
  const trashDir = join(home, '.agents', '.trash')
  const lockPath = realSkillLockPath(home)
  const gooseSkillsDir = join(home, '.config', 'goose', 'skills')

  if (await entryKind(sourceAzure)) {
    reasons.push('azure-ai already exists in the canonical skills source')
  }

  const lock = await readSkillLock(lockPath)
  if (lockHasSkill(lock, 'azure-ai')) {
    reasons.push('azure-ai already has a real skills-lock record')
  }

  if ((await trashEntriesForSkill(trashDir, 'azure-ai')).length > 0) {
    reasons.push('azure-ai already has app-trash entries')
  }

  const agentDirs = new Set<string>()
  for (const agent of AGENT_DEFINITIONS) {
    agentDirs.add(join(home, agent.scanDir, 'skills'))
    agentDirs.add(join(home, agent.installDir, 'skills'))
  }
  for (const dir of agentDirs) {
    if (await entryKind(join(dir, 'azure-ai'))) {
      reasons.push(`azure-ai already exists in an agent skill path: ${dir}`)
    }
  }

  if ((await entryKind(gooseSkillsDir)) !== 'directory') {
    reasons.push('Goose skills directory is missing')
  }

  const protectedDirs = [
    join(home, '.claude', 'skills'),
    join(home, '.cursor', 'skills'),
  ]
  const protectedSnapshots = {
    claude: await snapshotProtectedDirectory(protectedDirs[0]),
    cursor: await snapshotProtectedDirectory(protectedDirs[1]),
  }
  const canonicalProtectedDirs = await Promise.all(
    protectedDirs.map(async (dir) => canonicalPathEvenIfMissing(dir)),
  )
  for (const writeDir of [sourceSkillsDir, gooseSkillsDir]) {
    const canonicalWriteDir = await canonicalPathEvenIfMissing(writeDir)
    const canonicalAzureTarget = join(canonicalWriteDir, 'azure-ai')
    for (const protectedDir of canonicalProtectedDirs) {
      if (
        isSameOrInside(canonicalWriteDir, protectedDir) ||
        isSameOrInside(canonicalAzureTarget, protectedDir)
      ) {
        reasons.push(
          `install target resolves into a protected skill directory: ${writeDir} -> ${canonicalWriteDir}`,
        )
      }
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    lockPath,
    gooseSkillsDir,
    protectedSnapshots,
  }
}

/**
 * Capture protected Claude/Cursor snapshots for later equality checks.
 * @param home - Real host home directory.
 * @returns Snapshots for both protected directories.
 * @example await captureProtectedSnapshots('/home/user')
 */
export async function captureProtectedSnapshots(
  home: string,
): Promise<ProtectedSnapshots> {
  return {
    claude: await snapshotProtectedDirectory(join(home, '.claude', 'skills')),
    cursor: await snapshotProtectedDirectory(join(home, '.cursor', 'skills')),
  }
}

/**
 * Create temporary app-local state for a real-HOME launch.
 * Exists because HOME must be real while Electron userData and PATH must stay
 * disposable. The empty PATH directory is a tripwire for PATH-resolved CLI
 * delegation, not proof against an absolute-path subprocess.
 * @returns Directories plus a cleanup routine limited to test-created temp paths.
 * @example const context = await createRealHomeLaunchContext()
 */
export async function createRealHomeLaunchContext(): Promise<RealHomeLaunchContext> {
  const userDataDir = await mkdtemp(
    join(tmpdir(), 'skills-desktop-real-userData-'),
  )
  const emptyPathDir = await mkdtemp(
    join(tmpdir(), 'skills-desktop-empty-path-'),
  )
  return {
    userDataDir,
    emptyPathDir,
    cleanup: async (): Promise<void> => {
      await rm(userDataDir, { recursive: true, force: true })
      await rm(emptyPathDir, { recursive: true, force: true })
    },
  }
}

/**
 * Launch the production Electron build with the real HOME and disposable app state.
 * Exists as the single place that wires the safety contract, so the spec cannot
 * accidentally inherit isolated-HOME paths or the developer's real userData.
 * @param home - Real host home directory.
 * @param context - Temporary userData/PATH context from {@link createRealHomeLaunchContext}.
 * @returns Launched Electron app; caller owns `close()`.
 * @example await launchRealHomeElectron(home, context)
 */
export async function launchRealHomeElectron(
  home: string,
  context: RealHomeLaunchContext,
): Promise<ElectronApplication> {
  return launchIsolatedElectron(home, {
    HOME: home,
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    E2E_USERDATA_DIR: context.userDataDir,
    PATH: context.emptyPathDir,
  })
}
