import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { test, expect } from '../fixtures/electron-app'

/**
 * End-to-end coverage for the single-instance lock in `src/main/index.ts`.
 *
 * Why this file exists: the lock is a two-process property, so no unit test
 * can observe it. The bug it prevents is silent and destructive — a second
 * launch runs `trashService.startupCleanup`, which sweeps EVERY orphan
 * tombstone, including the ones the already-running instance is still showing
 * an Undo button for. The user clicks Undo and their skill is gone.
 *
 * Asserting the second process merely exits is not enough: an instance could
 * quit after its sweep already ran. Both halves are checked below.
 */

/**
 * Path to the Electron binary. In a Node context the `electron` package's main
 * export is the executable path string; its published TypeScript types
 * describe the main-process API instead, so the cast is the only way to state
 * what the runtime value actually is.
 */
const electronExecutable = require('electron') as unknown as string

/** Directory name of the tombstone the second instance must not touch. */
const LIVE_TOMBSTONE_ENTRY = '1900000000000-still-undoable-abcdef12'

/**
 * Ceiling for the second instance, deliberately well under Playwright's 30s
 * per-test timeout. At parity the two race, and an instance that refuses to
 * quit would surface as a generic "Test timeout exceeded" instead of the
 * assertions below, which name the actual defect. A locked-out instance exits
 * in well under a second.
 */
const SECOND_INSTANCE_TIMEOUT_MS = 10_000

test('a second launch quits without sweeping the running instance live trash', async ({
  isolatedHome,
  appWindow,
}) => {
  // Arrange — `appWindow` is the primary instance, already past its own
  // startupCleanup. Stage the tombstone AFTER that sweep so the only process
  // that could remove it is the second instance we are about to launch. The
  // future timestamp keeps the entry outside any grace arithmetic.
  await appWindow.waitForLoadState('domcontentloaded')
  const liveTombstoneDir = join(
    isolatedHome,
    '.agents',
    '.trash',
    LIVE_TOMBSTONE_ENTRY,
  )
  mkdirSync(liveTombstoneDir, { recursive: true })
  writeFileSync(
    join(liveTombstoneDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 2,
      kind: 'source-backed',
      deletedAt: 1900000000000,
      skillName: 'Still Undoable',
      sourcePath: join(isolatedHome, '.agents', 'skills', 'still-undoable'),
      symlinks: [],
    }),
    'utf-8',
  )

  // Act — launch a second instance against the same HOME and userData dir.
  // Chromium keys its singleton on userData, so this is the real collision a
  // user creates by double-clicking the app icon while it is already running.
  const repoRoot = resolve(__dirname, '..', '..')
  const secondInstance = spawnSync(
    electronExecutable,
    [resolve(repoRoot, 'out', 'main', 'index.mjs')],
    {
      env: {
        ...process.env,
        HOME: isolatedHome,
        E2E_USERDATA_DIR: resolve(isolatedHome, 'userData'),
        E2E_DISABLE_UPDATE: '1',
        E2E_BACKGROUND_LAUNCH: '1',
      },
      timeout: SECOND_INSTANCE_TIMEOUT_MS,
      encoding: 'utf-8',
    },
  )

  // Assert — `error` is set by spawnSync both when the binary never launched
  // and when the timeout above had to kill the child, so checking it first
  // closes a false green: a wrong binary path leaves the tombstone untouched
  // for the trivial reason that no second instance ever ran. Status 0 is what
  // a locked-out instance exits with after `app.quit()`.
  expect(secondInstance.error).toBeUndefined()
  expect(secondInstance.status).toBe(0)
  // The whole point. Without the lock the second instance reaches
  // `app.whenReady`, runs startupCleanup, and this directory is gone.
  expect(existsSync(liveTombstoneDir)).toBe(true)
})
