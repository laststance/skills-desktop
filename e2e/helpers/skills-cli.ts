import { spawn } from 'node:child_process'

import {
  AZURE_SKILLS_REPO,
  AZURE_SKILL_NAMES,
  KILL_ESCALATION_MS,
  SKILLS_CLI_VERSION,
  SPAWN_TIMEOUT_MS,
} from '../constants'

interface RunResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

/**
 * Spawn `npx <args>` under an isolated HOME and collect stdout/stderr.
 *
 * Failure modes the caller MUST be able to distinguish:
 *   1. spawn-level error (ENOENT npx, EACCES) → promise rejects with the
 *      underlying error wrapped so the caller sees `npx not found` instead
 *      of a generic CLI failure.
 *   2. timeout → child receives SIGTERM, then SIGKILL after
 *      KILL_ESCALATION_MS if it ignores the polite signal. The promise still
 *      resolves with `timedOut: true` so the caller can attach diagnostic
 *      stderr to the thrown install error.
 *   3. non-zero exit → promise resolves with `code !== 0`; caller decides.
 *
 * The `settled` flag guards against Node's documented behavior of firing
 * BOTH 'error' and 'close' for spawn failures (e.g. ENOENT) — without it the
 * promise would settle twice and the second settle is a no-op only because
 * the Promise spec ignores it.
 *
 * @example
 * const result = await runNpx(['skills@1.5.1', 'add', 'foo'], '/tmp/home-xyz')
 * if (result.code !== 0) throw new Error(`exit ${result.code}: ${result.stderr}`)
 */
async function runNpx(args: string[], home: string): Promise<RunResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn('npx', args, {
      env: { ...process.env, HOME: home, PATH: process.env['PATH'] ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let killEscalationTimer: NodeJS.Timeout | null = null

    const overallTimer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      // Some skill CLIs trap SIGTERM for cleanup hooks. If the child is still
      // alive after KILL_ESCALATION_MS, escalate to SIGKILL so the test run
      // doesn't pile up zombie npx processes on the runner.
      killEscalationTimer = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, KILL_ESCALATION_MS)
    }, SPAWN_TIMEOUT_MS)

    const cleanupTimers = (): void => {
      clearTimeout(overallTimer)
      if (killEscalationTimer) clearTimeout(killEscalationTimer)
    }

    child.stdout?.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr?.on('data', (chunk) => (stderr += chunk.toString()))

    child.on('error', (spawnError) => {
      if (settled) return
      settled = true
      cleanupTimers()
      rejectRun(
        new Error(
          `Failed to spawn npx (args=${args.join(' ')}): ${spawnError.message}`,
        ),
      )
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      cleanupTimers()
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
