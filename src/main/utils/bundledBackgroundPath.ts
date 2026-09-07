import { join } from 'node:path'

import { app } from 'electron'

/** Resolves manifest-owned files for catalog/preview callers in Electron's built entry and packaged ASAR.
 * @param filename - A trusted filename from the bundled background manifest.
 * @returns The ASAR-aware absolute path to the bundled file.
 * @example bundledBackgroundPath('quiet-dunes.webp')
 */
export function bundledBackgroundPath(filename: string): string {
  // electron-vite starts the out/main entry; packaged applications report the app.asar root instead.
  const applicationRoot = app.isPackaged
    ? app.getAppPath()
    : join(app.getAppPath(), '../..')
  return join(applicationRoot, 'resources', 'backgrounds', filename)
}
