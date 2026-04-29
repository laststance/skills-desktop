import { spawn } from 'node:child_process'
import { lookup } from 'node:dns/promises'

import {
  AZURE_SKILLS_REPO,
  AZURE_SKILL_NAMES,
  KILL_ESCALATION_MS,
  NPM_REGISTRY_HOST,
  OFFLINE_DNS_TIMEOUT_MS,
  SKILLS_CLI_VERSION,
  SPAWN_TIMEOUT_MS,
} from '../constants'

/**
 * Distinguishable failure mode for `installAzureSkills` when the runner has
 * no path to the npm registry. Caught by `globalSetup` so a network blip
 * downgrades to a "skip with empty snapshot" instead of failing the whole
 * test run with an opaque CLI error.
 *
 * Use `instanceof OfflineError` rather than string-matching the message:
 * the message is for humans and may change.
 *
 * @example
 * try { await installAzureSkills(home) }
 * catch (err) {
 *   if (err instanceof OfflineError) markSnapshotOffline()
 *   else throw err
 * }
 */
export class OfflineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OfflineError'
  }
}

/**
 * Stderr/stdout substrings that mean "the network rejected us, not the
 * registry". Matched case-insensitively so npm's mixed casing
 * (`ECONNREFUSED` vs `network connect`) both hit. Kept narrow on purpose:
 * a false-positive offline classification would silently skip the install
 * on an actual CLI bug.
 */
const OFFLINE_STDERR_PATTERNS = [
  'ENOTFOUND',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'getaddrinfo',
  'network timed out',
  'request to https://registry.npmjs.org',
] as const

function matchesOfflineStderr(haystack: string): boolean {
  const lowered = haystack.toLowerCase()
  return OFFLINE_STDERR_PATTERNS.some((needle) =>
    lowered.includes(needle.toLowerCase()),
  )
}

/**
 * Race a DNS lookup of the npm registry against a short timeout to decide
 * whether the runner can reach the registry at all. Returns `true` only on
 * lookup error or timeout — a successful resolve does not guarantee
 * end-to-end TCP, but a failed resolve is sufficient evidence to skip.
 *
 * Why `dns.lookup` and not `fetch`: `lookup` is OS-level (uses the system
 * resolver + cache), so corporate DNS hijacks that block only npm still
 * fail here. `fetch` would pile a TLS handshake on top of the DNS budget
 * for no extra signal.
 *
 * @example
 * if (await isOffline()) console.log('skip')
 */
export async function isOffline(): Promise<boolean> {
  let timeoutHandle: NodeJS.Timeout | null = null
  try {
    const timeoutSignal = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error('dns lookup timeout')),
        OFFLINE_DNS_TIMEOUT_MS,
      )
    })
    await Promise.race([lookup(NPM_REGISTRY_HOST), timeoutSignal])
    return false
  } catch {
    return true
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

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
 *
 * Failure modes the caller MUST distinguish:
 *   - `OfflineError` → DNS pre-flight or post-spawn output indicates the
 *     runner can't reach npm. Caller should downgrade to an empty
 *     snapshot instead of failing the whole test run.
 *   - generic `Error` → CLI-level failure (auth, permission, schema
 *     change in the skills CLI). Caller MUST surface as a real failure
 *     because the diagnosis is in the message, not the network.
 *
 * Two checkpoints catch offline state:
 *   1. Pre-flight `isOffline()` — fastest path, avoids a 60s spawn when
 *      the runner is provably air-gapped.
 *   2. Post-spawn stderr pattern match — covers cases where DNS is fine
 *      but TCP is firewalled (DNS-only check would falsely classify the
 *      runner as online). `matchesOfflineStderr` re-classifies the
 *      non-zero exit as `OfflineError`.
 *
 * @example
 * await installAzureSkills('/tmp/skills-desktop-snapshot-abc')
 */
export async function installAzureSkills(home: string): Promise<void> {
  if (await isOffline()) {
    throw new OfflineError(
      `npm registry unreachable (DNS lookup of ${NPM_REGISTRY_HOST} failed within ${OFFLINE_DNS_TIMEOUT_MS}ms)`,
    )
  }

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
    if (matchesOfflineStderr(`${result.stderr}\n${result.stdout}`)) {
      throw new OfflineError(
        `npm registry unreachable during install (code=${result.code}, timedOut=${result.timedOut})\nstderr: ${result.stderr}`,
      )
    }
    throw new Error(
      `skills CLI install failed (code=${result.code}, timedOut=${result.timedOut})\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
    )
  }
}
