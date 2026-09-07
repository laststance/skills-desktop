import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { delimiter, join } from 'path'

import { match, P } from 'ts-pattern'

import { parseFormattedCount } from '@/main/services/leaderboardService'
import { REPO_PATTERN, SKILL_NAME_PATTERN } from '@/main/utils/skillIdentifiers'
import { AGENT_DEFINITIONS, SKILLS_CLI_VERSION } from '@/shared/constants'
import { repositoryId, toHttpUrl, toSkillRank } from '@/shared/types'
import type {
  SkillSearchResult,
  InstallOptions,
  CliCommandResult,
  InstallProgress,
  ProgressPercent,
  SearchQuery,
  SkillName,
} from '@/shared/types'

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
/**
 * Ceiling for non-cancellable commands, which are the ones that rewrite
 * `.skill-lock.json` (3 minutes). The CLI's `writeSkillLock` is a plain
 * `writeFile` with no temp+rename, so a SIGTERM landing mid-write truncates
 * the lock — and a truncated lock parses as an EMPTY one, silently dropping
 * every skill the user installed. The write itself is sub-millisecond; what
 * actually eats the 60s is `npx` resolving the package over the network. This
 * moves the expiry well clear of that fetch instead of removing the kill: an
 * unkillable child would hang the caller forever, which is the worse failure.
 */
const LOCK_WRITE_SPAWN_TIMEOUT_MS = 180_000
/** Signal used for user cancel and timeout kill paths. */
const PROCESS_KILL_SIGNAL: NodeJS.Signals = 'SIGTERM'
/** Uncatchable follow-up for a child that ignores {@link PROCESS_KILL_SIGNAL}. */
const PROCESS_FORCE_KILL_SIGNAL: NodeJS.Signals = 'SIGKILL'
/**
 * How long a timed-out child gets to die on SIGTERM before it is SIGKILLed and
 * the caller stops waiting (5 seconds). The wait exists so `runLockWrite` keeps
 * its mutex until the child can no longer touch `.skill-lock.json`; the ceiling
 * exists because an unkillable child must not hold the queue forever.
 */
const KILL_GRACE_MS = 5_000
/**
 * Matches both legacy `owner/repo@skill` output and current CLI lines with
 * trailing telemetry, for example `owner/repo@skill 402.7K installs`.
 */
const CLI_SEARCH_RESULT_PATTERN =
  /^([^@\s]+)@([^\s]+)(?:\s+(\d[\d,.]*(?:\s*[KMB])?)\s+installs?)?$/i

/**
 * Common Node.js binary locations missing from Finder-launched macOS apps.
 * GUI apps usually inherit only `/usr/bin:/bin:/usr/sbin:/sbin`, so `npx`
 * installed by Homebrew, mise, asdf, Volta, pnpm, or Bun is invisible unless
 * we add these user-level toolchain paths before spawning the skills CLI.
 */
const CLI_PATH_FALLBACKS = [
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.local', 'share', 'mise', 'shims'),
  join(homedir(), '.asdf', 'shims'),
  join(homedir(), '.volta', 'bin'),
  join(homedir(), '.bun', 'bin'),
  join(homedir(), 'Library', 'pnpm'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
] as const

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
 * Build a CLI-friendly PATH without requiring the app to be launched from a
 * terminal session.
 * @param basePath - PATH inherited by the Electron main process
 * @returns PATH with common Node toolchain directories appended once
 * @example
 * buildCliPath('/usr/bin:/bin').includes('/opt/homebrew/bin') // => true
 */
function buildCliPath(basePath = process.env.PATH ?? ''): string {
  const entries = [...basePath.split(delimiter), ...CLI_PATH_FALLBACKS].filter(
    Boolean,
  )
  return Array.from(new Set(entries)).join(delimiter)
}

/**
 * Environment used for `npx skills ...` child processes.
 * @returns Process env with ANSI disabled and GUI-safe PATH expansion
 * @example
 * buildCliEnv().FORCE_COLOR // => '0'
 */
function buildCliEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FORCE_COLOR: '0',
    PATH: buildCliPath(),
  }
}

/**
 * Service for executing skills CLI commands via npx.
 * Wraps `npx skills@<SKILLS_CLI_VERSION>` with proper output parsing — the
 * version is imported from shared constants so upgrades happen in one place.
 */
class SkillsCliService extends EventEmitter {
  private runningProcesses = new Set<ChildProcess>()
  /**
   * Bumped by every {@link cancel}. Callers that queue work behind an async
   * gate capture this before waiting and re-check it before spawning, because
   * `cancel()` can only sweep children that already exist.
   */
  private cancelCount = 0

  /**
   * Search for skills using `npx skills find <query>`
   * @param query - Search query string
   * @returns Array of matching skills
   * @example
   * search('react')
   * // => [{ rank: 1, name: 'vercel-react-best-practices', repo: 'vercel-labs/agent-skills', url: '...' }]
   */
  async search(query: SearchQuery): Promise<SkillSearchResult[]> {
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
      /* v8 ignore next -- AgentId is derived from AGENT_DEFINITIONS and AGENT_ID_TO_CLI_NAME is built from the same source, so install()'s typed `agents` always map; the `?? agent` fallback is unreachable via the public surface */
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
   * Remove skills from the global lock using `npx skills remove <names...>`.
   * Called by {@link pruneLockEntries} to prune records whose skill is already
   * gone from disk; the CLI owns the lock format, so the app never writes it.
   *
   * Deliberately passes no `onOutput` callback: `parseProgressFromOutput`
   * would emit install-phase progress into the Marketplace UI from a
   * background prune the user never started.
   * @param names - Raw lock keys, as they appear in `.skill-lock.json`.
   * @returns CLI result. Note the exit code is NOT authoritative — `remove.ts`
   *   logs per-item failures and still exits 0, so callers verify by
   *   re-reading the lock.
   * @example
   * removeSkills(['old-skill'])
   * // spawns: npx skills@x.y.z remove old-skill --global -y
   */
  async removeSkills(names: readonly SkillName[]): Promise<CliCommandResult> {
    // Lock keys are written by the upstream CLI from third-party skill
    // metadata; this app never validated them. `--all` and `*` are SELECTORS in
    // the CLI's own argument parser, so either one turns this unattended prune
    // into a global uninstall across every agent. The CLI implements no `--`
    // terminator, so argument position alone cannot make them inert — the names
    // have to be refused here. Refused keys survive in the lock and the caller
    // reports them as `failed` when it re-reads it.
    const removable = names.filter((name) => SKILL_NAME_PATTERN.test(name))
    const refused = names.filter((name) => !SKILL_NAME_PATTERN.test(name))
    if (refused.length > 0) {
      console.error('skillsCliService: refusing option-shaped lock keys', {
        refused,
      })
    }
    if (removable.length === 0) {
      return {
        success: false,
        stdout: '',
        stderr: `Refused ${refused.length} lock key(s) that the skills CLI would read as options, not skill names.`,
        code: null,
      }
    }
    return this.execCli(
      ['remove', ...removable, CLI_FLAGS.GLOBAL, CLI_FLAGS.YES],
      undefined,
      { cancellable: false },
    )
  }

  /**
   * Cancel all currently-running CLI operations by sending `SIGTERM` to each
   * spawned child process. Used by the renderer to abort an in-progress
   * install when the user closes the install dialog.
   *
   * Lock-writing commands (see `removeSkills`) never join the sweep: closing
   * the install dialog must not kill a background prune mid-write.
   */
  cancel(): void {
    this.cancelCount += 1
    for (const proc of this.runningProcesses) {
      proc.kill(PROCESS_KILL_SIGNAL)
    }
  }

  /**
   * Monotonic count of {@link cancel} calls, so work that waited in a queue can
   * tell whether a cancel landed during the wait. Read before queueing and
   * again before spawning; a changed value means "the user already backed out".
   * @returns Number of cancels issued since app start.
   * @example const before = skillsCliService.cancelGeneration
   */
  get cancelGeneration(): number {
    return this.cancelCount
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
    { cancellable = true }: { cancellable?: boolean } = {},
  ): Promise<CliExecutionResult> {
    return new Promise((resolve) => {
      let stdout = ''
      let stderr = ''
      let settled = false

      // Finder-launched macOS apps do not inherit shell PATH, so buildCliEnv()
      // restores the common Node toolchain locations before resolving `npx`.
      const proc = spawn('npx', [`skills@${SKILLS_CLI_VERSION}`, ...args], {
        env: buildCliEnv(),
      })

      // Only cancellable commands join the set `cancel()` sweeps. A prune
      // rewrites .skill-lock.json with a plain writeFile (no temp+rename), so
      // a SIGTERM aimed at an unrelated install would truncate the lock.
      if (cancellable) this.runningProcesses.add(proc)

      // Non-cancellable == lock-rewriting. See LOCK_WRITE_SPAWN_TIMEOUT_MS.
      const timeoutMs = cancellable
        ? SPAWN_TIMEOUT_MS
        : LOCK_WRITE_SPAWN_TIMEOUT_MS

      // Set the moment the ceiling expires, so whichever path resolves reports
      // the timeout rather than whatever exit code the kill produced.
      let timedOut = false
      let killGraceHandle: NodeJS.Timeout | undefined

      const finalize = (result: CliExecutionResult): void => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeoutHandle)
        clearTimeout(killGraceHandle)
        this.runningProcesses.delete(proc)
        resolve(result)
      }

      const finalizeTimedOut = (): void =>
        finalize({
          success: false,
          stdout,
          stderr: this.buildTimeoutMessage(timeoutMs),
          code: null,
          timedOut: true,
        })

      const timeoutHandle = setTimeout(() => {
        timedOut = true
        proc.kill(PROCESS_KILL_SIGNAL)
        // Deliberately NOT resolving here. Resolving on the kill releases the
        // `runLockWrite` mutex while the child may still be mid-writeFile on
        // .skill-lock.json — the CLI writes it with no temp+rename, so the next
        // queued command interleaving with that write truncates the lock, and a
        // truncated lock parses as an empty one. The `close` handler resolves
        // once the child is actually gone.
        killGraceHandle = setTimeout(() => {
          // SIGTERM ignored. Force it, then stop waiting: holding the queue on
          // an unkillable child is the worse failure.
          proc.kill(PROCESS_FORCE_KILL_SIGNAL)
          finalizeTimedOut()
        }, KILL_GRACE_MS)
      }, timeoutMs)

      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        stdout += text
        onOutput?.(text)
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        // The kill landed and the child is gone — only now is releasing safe.
        if (timedOut) {
          finalizeTimedOut()
          return
        }
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
   * Build the user-facing timeout message for whichever ceiling actually fired.
   * @param timeoutMs - The ceiling that expired, in milliseconds.
   * @returns Message naming the elapsed limit in whole seconds.
   * @example buildTimeoutMessage(60_000) // => 'CLI command timed out after 60s'
   */
  private buildTimeoutMessage(timeoutMs: number): string {
    const timeoutSeconds = Math.floor(timeoutMs / 1000)
    return `CLI command timed out after ${timeoutSeconds}s`
  }

  /**
   * Parse `npx skills find` output into structured results
   * Output format:
   * ```
   * vercel-labs/agent-skills@vercel-react-best-practices 402.7K installs
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

      // Match result rows while skipping banners, hints, and blank lines.
      const match = line.match(CLI_SEARCH_RESULT_PATTERN)
      if (match) {
        const [, repo, name, installCountText] = match
        // Reject anything that isn't a plain npm/GitHub identifier — see
        // SKILL_NAME_PATTERN comment. Without this, a malformed CLI line
        // could land in aria-labels and copy-paste hints downstream.
        if (!REPO_PATTERN.test(repo) || !SKILL_NAME_PATTERN.test(name)) {
          continue
        }
        // Next line should be the URL
        const urlLine = lines[i + 1]?.trim()
        const urlMatch = urlLine?.match(/^[└├]\s*(https?:\/\/[^\s]+)$/)

        const searchResult: SkillSearchResult = {
          rank: toSkillRank(rank++),
          name,
          repo: repositoryId(repo),
          url: toHttpUrl(urlMatch?.[1] || `https://skills.sh/${repo}/${name}`),
        }
        // Older CLI output omits telemetry, so only attach the field when seen.
        if (installCountText) {
          searchResult.installCount = parseFormattedCount(installCountText)
        }
        results.push(searchResult)
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
    percent?: ProgressPercent,
  ): void {
    this.emit('progress', { phase, message, percent })
  }
}

// Export singleton instance
export const skillsCliService = new SkillsCliService()
