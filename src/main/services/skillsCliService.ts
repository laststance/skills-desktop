import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

import { match, P } from 'ts-pattern'

import { AGENT_DEFINITIONS, SKILLS_CLI_VERSION } from '../../shared/constants'
import { repositoryId } from '../../shared/types'
import type {
  SkillSearchResult,
  InstallOptions,
  CliCommandResult,
  InstallProgress,
} from '../../shared/types'
import { REPO_PATTERN, SKILL_NAME_PATTERN } from '../utils/skillIdentifiers'

/**
 * Build agent ID to CLI name mapping from AGENT_DEFINITIONS
 * This ensures the mapping stays in sync with the shared constants
 */
const AGENT_ID_TO_CLI_NAME = Object.fromEntries(
  AGENT_DEFINITIONS.map((agent) => [agent.id, agent.cliId]),
)

/**
 * CLI flag constants so every `npx skills ...` call uses the same strings.
 * Centralized to keep install/remove flag semantics in one obvious place —
 * the `--global` default matches skill registration (`.skill-lock.json` lives
 * under the global scope), and `-y` suppresses the interactive confirmation
 * prompt the CLI would otherwise hang on.
 */
const CLI_FLAGS = {
  GLOBAL: '--global',
  YES: '-y',
} as const

/** Hard timeout per spawned `npx skills ...` child process (60 seconds). */
const SPAWN_TIMEOUT_MS = 60_000
/** Signal used for user cancel and timeout kill paths. */
const PROCESS_KILL_SIGNAL: NodeJS.Signals = 'SIGTERM'

/**
 * Internal execution payload from `execCli`.
 * Extends `CliCommandResult` with a timeout sentinel so callers can map
 * user-facing error copy without overloading `code`.
 */
interface CliExecutionResult extends CliCommandResult {
  timedOut: boolean
}

/**
 * Remove ANSI escape sequences from a string
 * @param text - Text with potential ANSI codes
 * @returns Clean text without ANSI codes
 */
function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\[[\d;]*m/g, '')
}

/**
 * Service for executing skills CLI commands via npx.
 * Wraps `npx skills@<SKILLS_CLI_VERSION>` with proper output parsing — the
 * version is imported from shared constants so upgrades happen in one place.
 */
class SkillsCliService extends EventEmitter {
  private runningProcesses = new Set<ChildProcess>()

  /**
   * Search for skills using `npx skills find <query>`
   * @param query - Search query string
   * @returns Array of matching skills
   * @example
   * search('react')
   * // => [{ rank: 1, name: 'vercel-react-best-practices', repo: 'vercel-labs/agent-skills', url: '...' }]
   */
  async search(query: string): Promise<SkillSearchResult[]> {
    const result = await this.execCli(['find', query])
    if (!result.success) {
      return []
    }
    return this.parseSearchOutput(result.stdout)
  }

  /**
   * Install a skill using `npx skills add <repo>`
   * @param options - Installation options
   * @returns CLI command result
   * @example
   * install({ repo: 'vercel-labs/agent-skills', global: true, agents: ['claude-code'] })
   */
  async install(options: InstallOptions): Promise<CliCommandResult> {
    const args = ['add', options.repo, CLI_FLAGS.YES]

    if (options.global) {
      args.push(CLI_FLAGS.GLOBAL)
    }

    for (const agent of options.agents) {
      // Map internal agent ID to CLI identifier (e.g., 'claude' → 'claude-code')
      const cliAgentName = AGENT_ID_TO_CLI_NAME[agent] ?? agent
      args.push('--agent', cliAgentName)
    }

    if (options.skills && options.skills.length > 0) {
      for (const skill of options.skills) {
        args.push('--skill', skill)
      }
    }

    this.emitProgress('cloning', 'Cloning repository...')
    const result = await this.execCli(args, (data) => {
      this.parseProgressFromOutput(data)
    })

    if (result.success) {
      this.emitProgress('complete', 'Installation complete')
    } else {
      this.emitProgress('error', result.stderr || 'Installation failed')
    }

    return result
  }

  /**
   * Cancel all currently-running CLI operations by sending `SIGTERM` to each
   * spawned child process. Used by the renderer to abort an in-progress
   * install when the user closes the install dialog.
   */
  cancel(): void {
    for (const proc of this.runningProcesses) {
      proc.kill(PROCESS_KILL_SIGNAL)
    }
  }

  /**
   * Execute a skills CLI command
   * @param args - CLI arguments
   * @param onOutput - Optional callback for streaming output
   * @returns Command result
   */
  private async execCli(
    args: string[],
    onOutput?: (data: string) => void,
  ): Promise<CliExecutionResult> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false

      // Use npx to run skills CLI with FORCE_COLOR=0 to disable ANSI colors
      const proc = spawn('npx', [`skills@${SKILLS_CLI_VERSION}`, ...args], {
        env: { ...process.env, FORCE_COLOR: '0' },
      })

      this.runningProcesses.add(proc)

      const finalize = (result: CliExecutionResult): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeoutHandle)
        this.runningProcesses.delete(proc)
        resolve(result)
      }

      const timeoutHandle = setTimeout(() => {
        proc.kill(PROCESS_KILL_SIGNAL)
        finalize({
          success: false,
          stdout,
          stderr: this.buildTimeoutMessage(),
          code: null,
          timedOut: true,
        })
      }, SPAWN_TIMEOUT_MS)

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text
        onOutput?.(text)
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        finalize({
          success: code === 0,
          stdout,
          stderr,
          code,
          timedOut: false,
        })
      })

      proc.on('error', (error) => {
        finalize({
          success: false,
          stdout,
          stderr: error.message,
          code: null,
          timedOut: false,
        })
      })
    })
  }

  /**
   * Build the user-facing timeout message using the shared timeout constant.
   */
  private buildTimeoutMessage(): string {
    const timeoutSeconds = Math.floor(SPAWN_TIMEOUT_MS / 1000)
    return `CLI command timed out after ${timeoutSeconds}s`
  }

  /**
   * Parse `npx skills find` output into structured results
   * Output format:
   * ```
   * vercel-labs/agent-skills@vercel-react-best-practices
   * └ https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices
   * ```
   * @param output - Raw CLI output
   * @returns Parsed search results
   */
  private parseSearchOutput(output: string): SkillSearchResult[] {
    const results: SkillSearchResult[] = []
    // Strip ANSI codes and split into lines
    const cleanOutput = stripAnsi(output)
    const lines = cleanOutput.split('\n').filter((line) => line.trim())

    let rank = 1
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()

      // Match pattern: owner/repo@skill-name
      const match = line.match(/^([^@\s]+)@([^\s]+)$/)
      if (match) {
        const [, repo, name] = match
        // Reject anything that isn't a plain npm/GitHub identifier — see
        // SKILL_NAME_PATTERN comment. Without this, a malformed CLI line
        // could land in aria-labels and copy-paste hints downstream.
        if (!REPO_PATTERN.test(repo) || !SKILL_NAME_PATTERN.test(name)) {
          continue
        }
        // Next line should be the URL
        const urlLine = lines[i + 1]?.trim()
        const urlMatch = urlLine?.match(/^[└├]\s*(https?:\/\/[^\s]+)$/)

        results.push({
          rank: rank++,
          name,
          repo: repositoryId(repo),
          url: urlMatch?.[1] || `https://skills.sh/${repo}/${name}`,
        })
      }
    }

    return results
  }

  /**
   * Parse progress information from CLI output
   * @param data - Output chunk
   */
  private parseProgressFromOutput(data: string): void {
    const lower = data.toLowerCase()

    match(lower)
      .with(
        P.when(
          (s: string) => s.includes('cloning') || s.includes('downloading'),
        ),
        () => this.emitProgress('cloning', 'Cloning repository...'),
      )
      .with(
        P.when(
          (s: string) => s.includes('installing') || s.includes('copying'),
        ),
        () => this.emitProgress('installing', 'Installing skill files...'),
      )
      .with(
        P.when((s: string) => s.includes('linking') || s.includes('symlink')),
        () => this.emitProgress('linking', 'Creating agent symlinks...'),
      )
      .otherwise(() => {})
  }

  /**
   * Emit progress event
   * @param phase - Current phase
   * @param message - Progress message
   * @param percent - Optional percentage
   */
  private emitProgress(
    phase: InstallProgress['phase'],
    message: string,
    percent?: number,
  ): void {
    this.emit('progress', { phase, message, percent } as InstallProgress)
  }
}

// Export singleton instance
export const skillsCliService = new SkillsCliService()
