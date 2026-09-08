import { join } from 'node:path'

import { app } from 'electron'

/** Resolves manifest-owned files for catalog/preview callers in development and packaged extraResources.
 * @param filename - A trusted filename from the bundled background manifest.
 * @returns The absolute path to the bundled file in its runtime resource directory.
 * @example bundledBackgroundPath('quiet-dunes.webp')
 */
export function bundledBackgroundPath(filename: string): string {
  // electron-builder copies gallery files beside app.asar; development starts in the out/main entry.
  const resourcesRoot = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), '../../resources')
  return join(resourcesRoot, 'backgrounds', filename)
}
