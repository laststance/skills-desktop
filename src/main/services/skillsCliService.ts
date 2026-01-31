import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

import { AGENT_DEFINITIONS } from '../../shared/constants'
import type {
  SkillSearchResult,
  InstallOptions,
  CliCommandResult,
  InstallProgress,
} from '../../shared/types'

/**
 * Build agent ID to CLI name mapping from AGENT_DEFINITIONS
 * This ensures the mapping stays in sync with the shared constants
 */
const AGENT_ID_TO_CLI_NAME = Object.fromEntries(
  AGENT_DEFINITIONS.map((agent) => [agent.id, agent.cliId]),
)

/**
 * Remove ANSI escape sequences from a string
 * @param text - Text with potential ANSI codes
 * @returns Clean text without ANSI codes
 */
function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\[[\d;]*m/g, '')
}

/**
 * Service for executing skills CLI commands via npx
 * Wraps `npx skills@1.3.0` with proper output parsing
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
    const args = ['add', options.repo, '-y'] // -y to skip interactive prompts

    if (options.global) {
      args.push('--global')
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
   * Remove a skill using `npx skills remove <name> -g -y`
   * @param skillName - Name of the skill to remove
   * @returns CLI command result
   * @example
   * remove('vercel-react-best-practices')
   */
  async remove(skillName: string): Promise<CliCommandResult> {
    // -g flag for global scope (skills are installed globally)
    // -y flag skips interactive confirmation prompts
    return this.execCli(['remove', skillName, '-g', '-y'])
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
      const proc = spawn('npx', ['skills@1.3.0', ...args], {
        env: { ...process.env, FORCE_COLOR: '0' },
        shell: true,
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
        // Next line should be the URL
        const urlLine = lines[i + 1]?.trim()
        const urlMatch = urlLine?.match(/^[└├]\s*(https?:\/\/[^\s]+)$/)

        results.push({
          rank: rank++,
          name,
          repo,
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

    if (lower.includes('cloning') || lower.includes('downloading')) {
      this.emitProgress('cloning', 'Cloning repository...')
    } else if (lower.includes('installing') || lower.includes('copying')) {
      this.emitProgress('installing', 'Installing skill files...')
    } else if (lower.includes('linking') || lower.includes('symlink')) {
      this.emitProgress('linking', 'Creating agent symlinks...')
    }
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
