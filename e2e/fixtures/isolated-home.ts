import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { SNAPSHOT_INFO_FILE } from '../constants'

interface SnapshotInfo {
  snapshotHome: string
  createdAt: string
  /**
   * `true` when global-setup detected the runner is offline and skipped
   * `installAzureSkills`. Specs that depend on azure-* skills must read
   * this flag and `test.skip()` themselves so a network blip does not
   * surface as misleading UI assertion failures.
   */
  offline?: boolean
}

function readSnapshotInfo(): SnapshotInfo | null {
  const e2eRoot = resolve(__dirname, '..')
  const snapshotInfoPath = resolve(e2eRoot, SNAPSHOT_INFO_FILE)
  if (!existsSync(snapshotInfoPath)) return null
  return JSON.parse(readFileSync(snapshotInfoPath, 'utf-8')) as SnapshotInfo
}

/**
 * Create an isolated HOME for a single test. If a snapshot exists from
 * global-setup, the working HOME is hardlinked from it (~50ms reset);
 * otherwise an empty HOME is created with `.agents/skills/` scaffolded.
 *
 * Always returns a canonicalized path (firmlinks resolved) so symlink
 * target comparisons inside specs are stable on macOS.
 */
export function createIsolatedHome(): string {
  const workingHome = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'skills-desktop-e2e-home-')),
  )

  const snapshot = readSnapshotInfo()
  if (snapshot && existsSync(snapshot.snapshotHome)) {
    // cp -al preserves symlinks and hardlinks files. Reset is constant-time
    // because no I/O happens for hardlink creation. macOS supports -al.
    //
    // Caveat for future spec authors: hardlinked files share inodes across
    // every working HOME. In-place edits (writeFileSync over an existing
    // SKILL.md, appendFile, etc.) corrupt the snapshot for every subsequent
    // test. Safe ops: unlink, rmdir, mkdir+writeFile of NEW paths.
    try {
      execFileSync('cp', ['-al', `${snapshot.snapshotHome}/.`, workingHome], {
        stdio: 'inherit',
      })
    } catch (cpError) {
      // Without this cleanup, a partial copy leaks the empty workingHome
      // tempdir and the test reports a misleading "snapshot copy failed"
      // alongside an orphan dir under /tmp. rmSync is force/recursive so
      // a partially-populated tree won't block cleanup.
      rmSync(workingHome, { recursive: true, force: true })
      throw new Error(
        `Failed to hardlink snapshot ${snapshot.snapshotHome} to ${workingHome}: ${
          cpError instanceof Error ? cpError.message : String(cpError)
        }`,
      )
    }
  }

  return workingHome
}

/**
 * Tear down an isolated HOME. Best-effort: warns instead of throwing so
 * a stuck file lock never masks the actual test failure.
 */
export function destroyIsolatedHome(home: string): void {
  try {
    rmSync(home, { recursive: true, force: true })
  } catch (err) {
    console.warn(`[e2e] Failed to remove isolated home ${home}:`, err)
  }
}
