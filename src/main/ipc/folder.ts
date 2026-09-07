import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'

import { shell } from 'electron'

import { getAllowedBases, validatePath } from '@/main/services/pathValidation'
import { getSettings } from '@/main/services/settings'
import { errorCode } from '@/main/utils/errorCode'
import { TERMINAL_APP_DISPLAY_NAMES } from '@/shared/constants'
import { IPC_CHANNELS } from '@/shared/ipc-channels'
import type { Settings } from '@/shared/settings'
import type {
  AbsolutePath,
  FolderActionResult,
  TerminalAppId,
} from '@/shared/types'

import { typedHandle } from './typedHandle'

/**
 * Resolve the macOS app name to forward to `open -a <name>` for a given
 * `preferredTerminal` setting. Returns `null` when the setting is `'custom'`
 * but `customTerminalAppName` is missing/blank — the caller should surface
 * `{ ok: false, reason: 'invalid-path' }` so the user is told to fix Settings
 * rather than silently launching a wrong app.
 *
 * Pure (no fs / spawn) so it can be unit-tested without mocks. Exported so
 * `folder.test.ts` can hammer every branch of the curated × custom matrix.
 *
 * @param preferredTerminal - The setting value (`TerminalAppId`).
 * @param customTerminalAppName - Free-form app name, only honored when
 *   `preferredTerminal === 'custom'`. Should already be Zod-trimmed.
 * @param folderPath - Absolute path to the folder to open.
 * @returns
 * - For curated IDs: `['-a', '<DisplayName>', folderPath]`
 * - For `'custom'` with a non-blank name: `['-a', '<custom name>', folderPath]`
 * - For `'custom'` with a blank/missing name: `null`
 * @example
 * buildOpenArgs('terminal', undefined, '/x') // ['-a', 'Terminal', '/x']
 * buildOpenArgs('iterm', undefined, '/x')    // ['-a', 'iTerm', '/x']
 * buildOpenArgs('custom', 'Hyper', '/x')     // ['-a', 'Hyper', '/x']
 * buildOpenArgs('custom', undefined, '/x')   // null
 * buildOpenArgs('custom', '   ', '/x')       // null
 */
export function buildOpenArgs(
  preferredTerminal: TerminalAppId,
  customTerminalAppName: Settings['customTerminalAppName'],
  folderPath: AbsolutePath,
): readonly ['-a', string, AbsolutePath] | null {
  if (preferredTerminal === 'custom') {
    const trimmed = customTerminalAppName?.trim()
    if (!trimmed) return null
    return ['-a', trimmed, folderPath]
  }
  // Type system guarantees preferredTerminal is one of the curated IDs here.
  const displayName = TERMINAL_APP_DISPLAY_NAMES[preferredTerminal]
  return ['-a', displayName, folderPath]
}

/**
 * Authorize a renderer-supplied folder path, then verify it exists, before it
 * reaches a launcher. Three gates, in order:
 *
 * 1. {@link validatePath} against {@link getAllowedBases} — the renderer may
 *    only ask for the source dir or an agent scan dir. Every other path-taking
 *    IPC channel is allowlisted this way; without it `shell.openPath` and
 *    `open -a` would happily launch ANY absolute path, so a renderer running
 *    injected script could start an arbitrary app. The Zod schema on the
 *    channel only proves the string starts with `/`, and {@link toAbsolutePath}
 *    only brands — neither one authorizes.
 * 2. `realpath` existence — catches the "user deleted the folder between scan
 *    and click" race AND symlink loops (ELOOP) that would otherwise hang the
 *    launcher indefinitely.
 * 3. {@link validatePath} again, on the *canonical* path from gate 2. This is
 *    the gate that actually protects the launcher: gate 1 only vouches for the
 *    string the renderer sent, and a symlink swapped between the two resolves
 *    somewhere never authorized (TOCTOU, CWE-367). The returned path is the
 *    one that was authorized, so the two can no longer disagree.
 *
 * Returns the canonical (symlink-resolved) path on success — pass that to
 * `open` / `shell.openPath` so the launcher sees a real directory rather than
 * a broken symlink.
 *
 * @param requestedPath - Absolute path supplied by the renderer (Zod-validated
 *   as starting with `/`, but NOT yet authorized).
 * @returns
 * - `{ ok: true, resolved }` on success
 * - `{ ok: false, reason: 'invalid-path' }` when outside every allowed base
 * - `{ ok: false, reason: 'not-found' }` for ENOENT / ELOOP / ENOTDIR
 * @example
 * await resolveExistingPath(agentPath)  // '/Users/me/.claude/skills'
 * // => { ok: true, resolved: '/Users/me/.claude/skills' }
 * @example
 * await resolveExistingPath(elsewhere)  // '/etc'
 * // => { ok: false, reason: 'invalid-path' }
 */
async function resolveExistingPath(
  requestedPath: AbsolutePath,
): Promise<
  | { ok: true; resolved: AbsolutePath }
  | { ok: false; reason: 'not-found' | 'invalid-path' }
> {
  // Gate 1 — reject an unauthorized request up front, before touching the
  // filesystem, so the caller never has to echo the rejected path back into a
  // toast. Not load-bearing on its own: gate 3 is what actually protects the
  // launcher.
  try {
    validatePath(requestedPath, getAllowedBases())
  } catch {
    return { ok: false, reason: 'invalid-path' }
  }

  // Gate 2 — existence.
  let realPath: string
  try {
    realPath = await realpath(requestedPath)
  } catch (err) {
    const code = errorCode(err)
    // ENOENT: folder deleted externally. ELOOP: symlink cycle. ENOTDIR:
    // a parent component is a file, not a dir. All three are user-facing
    // "not found" from our POV — the launcher would fail the same way.
    if (code === 'ENOENT' || code === 'ELOOP' || code === 'ENOTDIR') {
      return { ok: false, reason: 'not-found' }
    }
    // Re-throw unexpected errors so the typedHandle wrapper logs them
    // and the renderer sees a generic launch-failed toast.
    throw err
  }

  // Gate 3 — authorize the CANONICAL result, which is the value the launcher
  // actually receives. Gate 1 only checked `requestedPath`; if a symlink
  // component were swapped between that check and the `realpath` above, the
  // resolved path could land outside the allowed bases (TOCTOU, CWE-367).
  // Validating the post-`realpath` value closes that window: authorization and
  // the returned value are now the same string.
  //
  // The residual race — replacing a real directory after this line — is not
  // closable without holding an O_PATH descriptor across the launcher call,
  // which `shell.openPath` / `open(1)` take a path for, not an fd.
  try {
    return { ok: true, resolved: validatePath(realPath, getAllowedBases()) }
  } catch {
    return { ok: false, reason: 'invalid-path' }
  }
}

/**
 * Map a {@link resolveExistingPath} rejection onto a user-safe
 * {@link FolderActionResult}.
 *
 * `not-found` names the path so the user knows *which* folder vanished —
 * useful when several agent rows look alike. `invalid-path` deliberately does
 * NOT echo it: a path outside the allowed bases did not come from the UI, so
 * reflecting it into a toast would just render an attacker-chosen string.
 */
function pathFailure(
  reason: 'not-found' | 'invalid-path',
  folderPath: AbsolutePath,
): FolderActionResult {
  if (reason === 'not-found') {
    return { ok: false, reason, message: `Folder not found: ${folderPath}` }
  }
  return {
    ok: false,
    reason,
    message: 'That folder is outside the Skills directories this app manages.',
  }
}

/**
 * Reveal a folder in the macOS Finder (parent dir opened, target highlighted
 * when possible). Wraps `shell.openPath` because Electron's `shell.openPath`
 * returns an empty string on success and an error string on failure (no
 * thrown exception) — we map that into the discriminated `FolderActionResult`
 * so the renderer can render a toast without try/catch.
 *
 * @param folderPath - Absolute path to the folder.
 */
async function revealInFinder(
  folderPath: AbsolutePath,
): Promise<FolderActionResult> {
  const existence = await resolveExistingPath(folderPath)
  if (!existence.ok) return pathFailure(existence.reason, folderPath)
  const errMessage = await shell.openPath(existence.resolved)
  if (errMessage !== '') {
    return {
      ok: false,
      reason: 'launch-failed',
      message: `Could not open folder: ${errMessage}`,
    }
  }
  return { ok: true }
}

/**
 * Spawn `open -a <appName> <folderPath>` and resolve once macOS reports
 * launch success/failure. We deliberately do NOT inherit stdio (silent in
 * dev console) and call `unref()` so the child process never keeps the
 * Electron main process alive at quit time.
 *
 * Resolves on either:
 * - `exit` event with code 0 → success
 * - `exit` event with non-zero code → app-not-installed (most common)
 * - `error` event → spawn failure (e.g. `open` binary missing — impossible
 *   on macOS but defensive)
 *
 * The Promise never rejects; the typedHandle boundary expects a value.
 *
 * @param folderPath - Absolute path to the folder to open.
 */
async function openInTerminal(
  folderPath: AbsolutePath,
): Promise<FolderActionResult> {
  const existence = await resolveExistingPath(folderPath)
  if (!existence.ok) return pathFailure(existence.reason, folderPath)

  // Read settings on EVERY call (not at module load) so a Settings change in
  // another window takes effect immediately on the next click — no app restart.
  // getSettings() is sync, in-memory; the cost is one object lookup per click.
  const settings = getSettings()
  const args = buildOpenArgs(
    settings.preferredTerminal,
    settings.customTerminalAppName,
    existence.resolved,
  )
  if (args === null) {
    return {
      ok: false,
      reason: 'invalid-path',
      message: 'Custom terminal name is empty. Set one in Settings → General.',
    }
  }

  return new Promise<FolderActionResult>((resolve) => {
    const child = spawn('open', [...args], { stdio: 'ignore' })
    // Detach from main process so quitting the app does not interrupt the
    // user's freshly-opened terminal.
    child.unref()

    child.once('exit', (code) => {
      if (code === 0) {
        resolve({ ok: true })
      } else {
        resolve({
          ok: false,
          reason: 'launch-failed',
          message: `Could not launch terminal. Is the chosen app installed? (exit ${code ?? 'null'})`,
        })
      }
    })

    child.once('error', (err) => {
      resolve({
        ok: false,
        reason: 'launch-failed',
        message: `Could not launch terminal: ${err.message}`,
      })
    })
  })
}

/**
 * Register IPC handlers for the "Reveal in Finder" / "Open in Terminal"
 * folder actions. Both channels are typed to return `FolderActionResult`
 * (never throw) so the renderer can dispatch a toast without try/catch.
 *
 * Intentionally exhaustive guard against `'custom'` mis-config (test 2.7
 * in the test plan): Settings UI prevents saving an empty custom name, but
 * a stale settings.json (or a renderer with race conditions) could still
 * surface here. Surfacing the error to the user beats silently launching
 * a wrong app.
 */
export function registerFolderHandlers(): void {
  typedHandle(IPC_CHANNELS.FOLDER_REVEAL_IN_FINDER, async (_event, path) => {
    return revealInFinder(path)
  })

  typedHandle(IPC_CHANNELS.FOLDER_OPEN_IN_TERMINAL, async (_event, path) => {
    return openInTerminal(path)
  })
}
