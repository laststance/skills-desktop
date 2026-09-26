import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

import { SNAPSHOT_INFO_FILE } from './constants'

/**
 * Best-effort cleanup of the snapshot HOME and its info file.
 * Never throws — teardown failures shouldn't mask test failures.
 */
async function globalTeardown(): Promise<void> {
  const e2eRoot = __dirname
  const snapshotInfoPath = resolve(e2eRoot, SNAPSHOT_INFO_FILE)

  if (!existsSync(snapshotInfoPath)) {
    console.log('[e2e:teardown] No snapshot info file — nothing to clean up')
    return
  }

  try {
    const info = JSON.parse(readFileSync(snapshotInfoPath, 'utf-8')) as {
      snapshotHome?: string
    }
    if (info.snapshotHome && existsSync(info.snapshotHome)) {
      rmSync(info.snapshotHome, { recursive: true, force: true })
      console.log(`[e2e:teardown] Removed snapshot HOME: ${info.snapshotHome}`)
    }
  } catch (err) {
    console.warn('[e2e:teardown] Cleanup warning:', err)
  } finally {
    rmSync(snapshotInfoPath, { force: true })
  }
}

export default globalTeardown
