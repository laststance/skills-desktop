import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { SNAPSHOT_INFO_FILE } from './constants'
import { installAzureSkills, OfflineError } from './helpers/skills-cli'

/**
 * Run the skills CLI install for the snapshot HOME and classify the
 * outcome. Returns `true` when the runner is provably offline; throws on
 * non-offline failures after tearing down the partial snapshot. Specs
 * that depend on azure-* skills branch on the returned flag (via the
 * snapshot info JSON) so a network blip downgrades to "skip these
 * specs" instead of cascading into UI assertion failures.
 */
async function installSnapshotOrClassifyOffline(
  snapshotHome: string,
): Promise<boolean> {
  console.log('[e2e:setup] Installing azure-* skills via skills CLI...')
  try {
    await installAzureSkills(snapshotHome)
    console.log('[e2e:setup] azure-* skills installed')
    return false
  } catch (err) {
    if (err instanceof OfflineError) {
      // Hard-reset the skills dir so `offline: true` matches actual contents.
      // The DNS pre-flight branch leaves it empty already, but the post-spawn
      // stderr-match branch can fire after `npx skills add` partially wrote a
      // few skills before TCP gave up. Without this, snapshot info would
      // claim "offline" while the hardlink-copy still reproduces a half-
      // populated tree into every working HOME.
      const skillsDir = join(snapshotHome, '.agents', 'skills')
      rmSync(skillsDir, { recursive: true, force: true })
      mkdirSync(skillsDir, { recursive: true })
      // Loud warning so a CI log scanner can grep for "OFFLINE" and the
      // operator can distinguish offline-skip from a real install bug
      // when reviewing flaky-run dashboards.
      console.warn(
        `[e2e:setup] OFFLINE — npm registry unreachable. Continuing with empty snapshot. Specs that depend on azure-* skills should skip themselves via the snapshot \`offline\` flag.\n[e2e:setup] OfflineError: ${err.message}`,
      )
      return true
    }
    // Tear down the partial snapshot before bubbling so we never leak
    // a polluted tempdir on a failed setup.
    rmSync(snapshotHome, { recursive: true, force: true })
    throw err
  }
}

/**
 * Build a snapshot HOME populated with the 7 azure-* skills.
 * Per-test fixtures hardlink-copy from this snapshot in ~50ms instead of
 * re-running the CLI install per test.
 *
 * If `E2E_SKIP_INSTALL=1` is set, skip the network install and just create
 * an empty snapshot HOME with agent dirs scaffolded — useful for smoke
 * tests that don't need the azure-* skills present.
 *
 * Offline behavior: when `installAzureSkills` raises `OfflineError` (DNS
 * pre-flight or stderr pattern indicates the runner can't reach npm), we
 * downgrade to "empty snapshot, log loudly, mark info JSON as offline"
 * instead of failing global-setup. Specs that need azure-* skills must
 * read the `offline` flag from snapshot info and `test.skip()` themselves
 * with a clear reason. This protects CI from a network blip surfacing as
 * dozens of unrelated UI assertion failures.
 */
async function globalSetup(): Promise<void> {
  const e2eRoot = __dirname
  const snapshotInfoPath = resolve(e2eRoot, SNAPSHOT_INFO_FILE)

  // realpathSync.native canonicalizes /var/folders → /private/var/folders
  // which is critical for symlink target comparisons inside specs.
  const snapshotHome = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'skills-desktop-e2e-snapshot-')),
  )
  console.log(`[e2e:setup] Snapshot HOME: ${snapshotHome}`)

  mkdirSync(join(snapshotHome, '.agents', 'skills'), { recursive: true })

  // `offline === true` is recorded in the snapshot info so per-test
  // fixtures and specs can branch on it (e.g., `test.skip()` for
  // azure-* dependent assertions). `E2E_SKIP_INSTALL` is treated as a
  // distinct opt-out — it is NOT offline; the runner just doesn't want
  // to pay the install cost for this run.
  let offline = false
  if (process.env['E2E_SKIP_INSTALL'] === '1') {
    console.log('[e2e:setup] E2E_SKIP_INSTALL=1 — skipping skills CLI install')
  } else {
    offline = await installSnapshotOrClassifyOffline(snapshotHome)
  }

  mkdirSync(dirname(snapshotInfoPath), { recursive: true })
  writeFileSync(
    snapshotInfoPath,
    JSON.stringify(
      { snapshotHome, createdAt: new Date().toISOString(), offline },
      null,
      2,
    ),
  )
  console.log(`[e2e:setup] Snapshot info → ${snapshotInfoPath}`)
}

export default globalSetup
