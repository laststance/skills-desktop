import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import type {
  CreateSandboxParams,
  SandboxResult,
} from '../../shared/chat-types'

const SANDBOX_DIR_NAME = 'skills-desktop-sandbox'

/**
 * Get the root sandbox directory path
 * @returns Absolute path to ~/skills-desktop-sandbox/
 */
function getSandboxRoot(): string {
  return path.join(os.homedir(), SANDBOX_DIR_NAME)
}

/**
 * Create a sandbox directory with CLAUDE.md for skill testing
 * @param params - Skill name to include in CLAUDE.md context
 * @returns Path to created sandbox directory
 * @example
 * const result = await createSandbox({ skillName: 'task' })
 * // => { path: '/Users/me/skills-desktop-sandbox/1773746342' }
 */
export async function createSandbox(
  params: CreateSandboxParams,
): Promise<SandboxResult> {
  const sandboxPath = path.join(getSandboxRoot(), String(Date.now()))
  await fs.mkdir(sandboxPath, { recursive: true })

  const claudeMd = buildClaudeMd(params.skillName)
  await fs.writeFile(path.join(sandboxPath, 'CLAUDE.md'), claudeMd, 'utf-8')

  return { path: sandboxPath }
}

/**
 * Remove a sandbox directory (validates path is under sandbox root)
 * @param sandboxPath - Absolute path to sandbox to remove
 * @throws Error if path is outside sandbox root or uses traversal
 * @example
 * await cleanupSandbox('/Users/me/skills-desktop-sandbox/1773746342')
 */
export async function cleanupSandbox(sandboxPath: string): Promise<void> {
  const root = getSandboxRoot()
  const resolved = path.resolve(sandboxPath)

  // Security: only allow deletion under sandbox root
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Invalid sandbox path: ${sandboxPath} is not under ${root}`)
  }

  await fs.rm(resolved, { recursive: true, force: true })
}

/**
 * Cleanup stale sandbox directories on app startup
 * Removes any directories older than 24 hours
 */
export async function cleanupStaleSandboxes(): Promise<void> {
  const root = getSandboxRoot()
  try {
    const entries = await fs.readdir(root)
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours

    for (const entry of entries) {
      const timestamp = Number(entry)
      if (!Number.isNaN(timestamp) && now - timestamp > maxAge) {
        await fs.rm(path.join(root, entry), { recursive: true, force: true })
      }
    }
  } catch {
    // Sandbox root doesn't exist yet — nothing to clean up
  }
}

/**
 * Build CLAUDE.md content for sandbox
 * @param skillName - Optional skill name to reference
 * @returns CLAUDE.md content string
 */
function buildClaudeMd(skillName: string | null): string {
  let content = `# Skills Sandbox

This is a sandbox project for testing skills.
Feel free to create files, install packages, and experiment.
This directory will be cleaned up when the sandbox is closed.
`

  if (skillName) {
    content += `\n## Active Skill: ${skillName}

Test the "${skillName}" skill by invoking it with /\`${skillName}\`.
`
  }

  return content
}
