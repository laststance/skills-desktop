import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { homedir } from 'os'

import { match, P } from 'ts-pattern'

import { AGENT_DEFINITIONS, SKILLS_CLI_VERSION } from '../../shared/constants'
import { repositoryId } from '../../shared/types'
import type {
  SkillSearchResult,
  InstallOptions,
  CliCommandResult,
  InstallProgress,
  CliRemoveSkillResult,
  SkillName,
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

/**
 * Remove ANSI escape sequences from a string
 * @param text - Text with potential ANSI codes
 * @returns Clean text without ANSI codes
 */
function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\[[\d;]*m/g, '')
}

/**
 * Cached at module scope so we don't hit the OS on every CLI invocation.
 * The home directory cannot change during a process lifetime on macOS/Linux
 * (the scenarios where it would change — `sudo -u`, `HOME=` env override —
 * we don't support for Skills Desktop).
 */
const HOME_DIR = homedir()
/**
 * Anchor HOME_DIR matches to a path boundary so `/Users/alice-work/foo` is
 * not rewritten to `~-work/foo` when HOME_DIR is `/Users/alice`. The
 * lookahead accepts: path separator (`/` or `\`), end-of-string, whitespace,
 * or a quote char — all the places a path legitimately terminates inside
 * CLI stderr output.
 */
const HOME_DIR_REGEX = new RegExp(
  HOME_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[/\\\\]|$|\\s|["\'`])',
  'g',
)

/**
 * Sanitize CLI output destined for the renderer (toasts, error UI, logs).
 * Strips ANSI and replaces the user's home directory with `~` so a stderr
 * like `ENOENT: /Users/alice/.agents/skills/foo` surfaces as `ENOENT:
 * ~/.agents/skills/foo` — keeps the actionable context, drops the username.
 *
 * Not a security boundary (the renderer is our own code), but defense-in-depth
 * against leaking PII into screenshots, bug reports, and log files.
 * @param text - Raw text from CLI stdout/stderr
 * @returns Sanitized text safe to surface in UI
 * @example
 * sanitizeCliMessage('ENOENT: /Users/alice/.agents/skills/foo')
 * // => 'ENOENT: ~/.agents/skills/foo'
 */
function sanitizeCliMessage(text: string): string {
  return stripAnsi(text).replace(HOME_DIR_REGEX, '~')
}

/**
 * Service for executing skills CLI commands via npx.
 * Wraps `npx skills@<SKILLS_CLI_VERSION>` with proper output parsing — the
 * version is imported from shared constants so upgrades happen in one place.
 */
class SkillsCliService extends EventEmitter {
  private currentProcess: ChildProcess | null = null

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
   * Deregister a skill from `~/.agents/.skill-lock.json` via `npx skills remove`.
   * CLI handles lock file update and filesystem removal in one shot — we never
   * touch the lock file directly, so schema drift stays the CLI's problem.
   * @param skillName - Skill name as tracked in the lock file
   * @returns Discriminated result: `{outcome:'removed'}` on exit 0, else `{outcome:'error', error}`
   * @example
   * remove('brainstorming' as SkillName)
   * // => { skillName: 'brainstorming', outcome: 'removed' }
   */
  async remove(skillName: SkillName): Promise<CliRemoveSkillResult> {
    const result = await this.execCli([
      'remove',
      skillName,
      CLI_FLAGS.GLOBAL,
      CLI_FLAGS.YES,
    ])

    if (result.success) {
      return { skillName, outcome: 'removed' }
    }

    // stderr often has the actionable message (e.g., "Skill not found").
    // Fall back to stdout when CLI writes errors there instead.
    // sanitize strips ANSI + home-directory paths before this string crosses
    // the IPC boundary into the renderer (toasts, future logging, crash
    // reports). See sanitizeCliMessage docstring.
    const rawMessage =
      result.stderr.trim() || result.stdout.trim() || 'CLI remove failed'
    return {
      skillName,
      outcome: 'error',
      error: { message: sanitizeCliMessage(rawMessage), code: result.code },
    }
  }

  /**
   * Cancel the current CLI operation
   */
  cancel(): void {
    if (this.currentProcess) {
      this.currentProcess.kill('SIGTERM')
      this.currentProcess = null
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
  ): Promise<CliCommandResult> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''

      // Use npx to run skills CLI with FORCE_COLOR=0 to disable ANSI colors
      const proc = spawn('npx', [`skills@${SKILLS_CLI_VERSION}`, ...args], {
        env: { ...process.env, FORCE_COLOR: '0' },
      })

      this.currentProcess = proc

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text
        onOutput?.(text)
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        this.currentProcess = null
        resolve({
          success: code === 0,
          stdout,
          stderr,
          code,
        })
      })

      proc.on('error', (error) => {
        this.currentProcess = null
        resolve({
          success: false,
          stdout,
          stderr: error.message,
          code: null,
        })
      })
    })
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
