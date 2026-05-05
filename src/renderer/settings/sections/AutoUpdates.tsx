import React from 'react'

import { Checkbox } from '@/renderer/src/components/ui/checkbox'

import { MockControl, SectionFrame, SectionRow } from './SectionFrame'

/**
 * Auto Updates pane — visual stub for v0.15.0.
 *
 * Real updater behavior (auto-download, install-on-quit) is owned by
 * `electron-updater` in `src/main/updater.ts`. Wiring user-facing
 * toggles requires propagating values into that module's runtime
 * config (`autoUpdater.autoDownload`, `allowPrerelease`). That
 * roundtrip is out of scope for the v0.15.0 Settings shell — see the
 * "Out of scope" list in the plan. The "Check for Updates" trigger
 * lives in the About pane and IS wired to the real updater.
 */
export const AutoUpdates = React.memo(
  function AutoUpdates(): React.ReactElement {
    return (
      <SectionFrame
        title="Auto Updates"
        description="Control how Skills Desktop fetches new releases."
      >
        <SectionRow
          label="Auto-download updates"
          description="Download in the background when a new version ships."
        >
          <MockControl>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox disabled />
              <span>Download updates automatically</span>
            </label>
          </MockControl>
        </SectionRow>
        <SectionRow
          label="Beta channel"
          description="Receive pre-release builds before stable promotion."
        >
          <MockControl>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox disabled />
              <span>Opt into beta releases</span>
            </label>
          </MockControl>
        </SectionRow>
      </SectionFrame>
    )
  },
)
