import React from 'react'

import { getReleaseNotesUrl } from '../../utils/getReleaseNotesUrl'
import { ThemeSelector } from '../theme/ThemeSelector'

/**
 * Sidebar header with app title and theme selector.
 *
 * The version label is a link to the matching GitHub release tag so users
 * can read the changelog after an auto-update. `target="_blank"` is enough
 * here — the main process's `setWindowOpenHandler` already routes
 * `window.open` calls to `shell.openExternal`, so no IPC is required.
 */
export const SidebarHeader = React.memo(
  function SidebarHeader(): React.ReactElement {
    const releaseNotesUrl = getReleaseNotesUrl(__APP_VERSION__)
    return (
      <div className="p-4 pt-8 drag-region">
        <div className="flex items-center justify-between no-drag">
          <div>
            <h1 className="font-mono text-lg font-semibold text-primary">
              Skills Desktop
            </h1>
            <a
              href={releaseNotesUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="View release notes on GitHub"
              className="text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm transition-colors"
            >
              v{__APP_VERSION__}
            </a>
          </div>
          <ThemeSelector />
        </div>
      </div>
    )
  },
)
