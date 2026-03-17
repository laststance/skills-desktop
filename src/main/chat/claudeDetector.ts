import { execSync } from 'child_process'
import * as os from 'os'

import type { ClaudeStatus } from '../../shared/chat-types'

/** Cached detection result (stable for app lifetime) */
let cachedResult: ClaudeStatus | null = null

/**
 * Detect system-installed Claude Code binary
 * Searches PATH via login shell to find claude executable
 * Results are cached for app lifetime
 * @returns Detection result with availability, path, and version
 * @example
 * const status = await detectClaude()
 * // => { available: true, path: '/usr/local/bin/claude', version: '2.1.0' }
 */
export async function detectClaude(): Promise<ClaudeStatus> {
  if (cachedResult) return cachedResult

  let claudePath: string | null = null
  let version: string | null = null

  try {
    // Use login shell to pick up PATH from user's shell profile (nvm, homebrew, etc.)
    const shell = process.env.SHELL || '/bin/zsh'
    const result = execSync(`${shell} -ilc 'which claude'`, {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        HOME: os.homedir(),
        USER: os.userInfo().username,
        SHELL: shell,
        DISABLE_AUTO_UPDATE: 'true',
      },
    })
    claudePath = result.trim()
  } catch {
    cachedResult = { available: false, path: null, version: null }
    return cachedResult
  }

  if (!claudePath) {
    cachedResult = { available: false, path: null, version: null }
    return cachedResult
  }

  try {
    const versionOutput = execSync(`${claudePath} --version`, {
      encoding: 'utf8',
      timeout: 5000,
    })
    // Parse "claude X.Y.Z" or just "X.Y.Z"
    const match = versionOutput.trim().match(/(\d+\.\d+\.\d+)/)
    version = match ? match[1] : null
  } catch {
    // Version detection failed, but claude binary exists
  }

  cachedResult = { available: true, path: claudePath, version }
  return cachedResult
}

/**
 * Clear cached detection result (for retry)
 */
export function clearClaudeCache(): void {
  cachedResult = null
}
