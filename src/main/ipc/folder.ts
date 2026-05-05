import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'

import { shell } from 'electron'

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
 * Verify a path exists on disk before handing it to a launcher. Catches the
 * "user deleted the folder externally between scan and click" race AND
 * symlink loops (ELOOP) that would otherwise hang `realpath` indefinitely.
 *
 * Returns the canonical (symlink-resolved) path on success — pass that
 * to `open` / `shell.openPath` so the launcher sees a real directory rather
 * than a broken symlink.
 *
 * @param requestedPath - Absolute path supplied by the renderer (already
 *   Zod-validated as starting with `/`).
 * @returns
 * - `{ ok: true, resolved }` on success
 * - `{ ok: false, reason: 'not-found' }` for ENOENT / ELOOP / ENOTDIR
 */
async function resolveExistingPath(
  requestedPath: AbsolutePath,
): Promise<
  { ok: true; resolved: AbsolutePath } | { ok: false; reason: 'not-found' }
> {
  try {
    const resolved = await realpath(requestedPath)
    return { ok: true, resolved }
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
}

/**
 * Format a user-safe error message for `not-found` toasts. The path is
 * included so the user knows *which* folder vanished — useful when several
 * agent rows are shown side-by-side.
 */
function notFoundMessage(folderPath: AbsolutePath): string {
  return `Folder not found: ${folderPath}`
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
  if (!existence.ok) {
    return {
      ok: false,
      reason: 'not-found',
      message: notFoundMessage(folderPath),
    }
  }
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
  if (!existence.ok) {
    return {
      ok: false,
      reason: 'not-found',
      message: notFoundMessage(folderPath),
    }
  }

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
