import * as fs from 'node:fs/promises'

import { errorCode } from '@/main/utils/errorCode'
import { extractErrorMessage } from '@/main/utils/errors'

/**
 * Flush one file or directory to stable storage so a power cut cannot lose it.
 * Exists because `fs.writeFile` and `fs.rename` return once the change is in
 * the page cache; trash publishes call it between their write and their rename
 * so a torn manifest cannot outlive the tombstone that promises it.
 * Never throws: an fsync rejection means the bytes are still cached and the
 * caller's operation genuinely succeeded, so propagating it would roll back a
 * delete that worked. Opened read-only — POSIX `fsync` needs a valid fd, not a
 * writable one, which is also what lets one helper cover directories.
 * ponytail: POSIX-only ceiling -- Windows refuses to open a directory, where
 * this degrades to a logged warning and the file flushes still land. Upgrade
 * to a platform branch if the app ever ships beyond macOS.
 * @param path - Absolute file or directory path to flush.
 * @returns Promise that resolves after the flush, or after logging its failure.
 * @example await fsyncPath(join(entryDir, 'manifest.json'))
 */
export async function fsyncPath(path: string): Promise<void> {
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(path, 'r')
    await handle.sync()
  } catch (error) {
    console.warn('fsyncPath: flush failed', {
      path,
      code: errorCode(error),
      message: extractErrorMessage(error),
    })
  } finally {
    // Closing is its own failure mode: the flush may have landed even when the
    // handle cannot be released, and leaking an fd is worse than a warning.
    await handle?.close().catch(() => {
      // best-effort close
    })
  }
}
