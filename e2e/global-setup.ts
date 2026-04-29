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
import { installAzureSkills } from './helpers/skills-cli'

/**
 * Build a snapshot HOME populated with the 7 azure-* skills.
 * Per-test fixtures hardlink-copy from this snapshot in ~50ms instead of
 * re-running the CLI install per test.
 *
 * If `E2E_SKIP_INSTALL=1` is set, skip the network install and just create
 * an empty snapshot HOME with agent dirs scaffolded — useful for smoke
 * tests that don't need the azure-* skills present.
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

  if (process.env['E2E_SKIP_INSTALL'] === '1') {
    console.log('[e2e:setup] E2E_SKIP_INSTALL=1 — skipping skills CLI install')
  } else {
    console.log('[e2e:setup] Installing azure-* skills via skills CLI...')
    try {
      await installAzureSkills(snapshotHome)
      console.log('[e2e:setup] azure-* skills installed')
    } catch (err) {
      // Tear down the partial snapshot before bubbling so we never leak
      // a polluted tempdir on a failed setup.
      rmSync(snapshotHome, { recursive: true, force: true })
      throw err
    }
  }

  mkdirSync(dirname(snapshotInfoPath), { recursive: true })
  writeFileSync(
    snapshotInfoPath,
    JSON.stringify(
      { snapshotHome, createdAt: new Date().toISOString() },
      null,
      2,
    ),
  )
  console.log(`[e2e:setup] Snapshot info → ${snapshotInfoPath}`)
}

export default globalSetup
