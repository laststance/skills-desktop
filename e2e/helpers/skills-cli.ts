import { spawn } from 'node:child_process'

import {
  AZURE_SKILLS_REPO,
  AZURE_SKILL_NAMES,
  SKILLS_CLI_VERSION,
} from '../constants'

const SPAWN_TIMEOUT_MS = 60_000

interface RunResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

async function runNpx(args: string[], home: string): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const child = spawn('npx', args, {
      env: { ...process.env, HOME: home, PATH: process.env['PATH'] ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, SPAWN_TIMEOUT_MS)
    child.stdout?.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolveRun({ code: code ?? -1, stdout, stderr, timedOut })
    })
  })
}

/**
 * Install all 7 azure-* skills under the given HOME using the pinned
 * skills CLI. Used by global-setup to populate the snapshot HOME.
 * @example
 * await installAzureSkills('/tmp/skills-desktop-snapshot-abc')
 */
export async function installAzureSkills(home: string): Promise<void> {
  const args = [
    `skills@${SKILLS_CLI_VERSION}`,
    'add',
    AZURE_SKILLS_REPO,
    '-y',
    '--global',
  ]
  for (const skill of AZURE_SKILL_NAMES) {
    args.push('--skill', skill)
  }
  const result = await runNpx(args, home)
  if (result.code !== 0) {
    throw new Error(
      `skills CLI install failed (code=${result.code}, timedOut=${result.timedOut})\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    )
  }
}

/**
 * Remove all 7 azure-* skills from the given HOME.
 * Errors per skill are logged but never throw — best-effort cleanup so
 * teardown never blocks suite completion.
 */
export async function uninstallAzureSkills(home: string): Promise<void> {
  for (const skill of AZURE_SKILL_NAMES) {
    const result = await runNpx(
      ['skills@' + SKILLS_CLI_VERSION, 'remove', skill, '--global', '-y'],
      home,
    )
    if (result.code !== 0) {
      console.warn(
        `[e2e] skills remove ${skill} returned code ${result.code} (best-effort cleanup, continuing)`,
      )
    }
  }
}
