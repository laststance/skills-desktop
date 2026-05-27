import React, { useCallback } from 'react'

import { Checkbox } from '@/renderer/src/components/ui/checkbox'
import { useUpdateSettings } from '@/renderer/src/hooks/useUpdateSettings'
import { useAppSelector } from '@/renderer/src/redux/hooks'

import { SectionFrame, SectionRow } from './SectionFrame'

/**
 * Auto Updates pane — wired to the real `electron-updater` config.
 *
 * One persisted boolean drives the updater at boot and live (mirrors the
 * `windowBackgroundBlurRadius` flow): `autoDownloadUpdates` →
 * `autoUpdater.autoDownload`. The settings round-trip (optimistic dispatch +
 * `settings:set` IPC) is owned by `useUpdateSettings`; the main process
 * applies the value in `src/main/updater.ts`. The "Check for Updates" trigger
 * lives in the About pane and is wired to the same updater instance.
 */
export const AutoUpdates = React.memo(
  function AutoUpdates(): React.ReactElement {
    const settings = useAppSelector((state) => state.settings)
    const updateSettings = useUpdateSettings()

    // Radix Checkbox reports `boolean | 'indeterminate'`; coerce to a strict
    // boolean so we never persist the indeterminate sentinel.
    const handleAutoDownloadChange = useCallback(
      (checked: boolean | 'indeterminate'): void => {
        updateSettings({ autoDownloadUpdates: checked === true })
      },
      [updateSettings],
    )

    return (
      <SectionFrame
        title="Auto Updates"
        description="Control how Skills Desktop fetches new releases."
      >
        <SectionRow
          label="Auto-download updates"
          description="Download in the background when a new version ships."
        >
          <label className="flex w-fit items-center gap-2 text-sm">
            <Checkbox
              checked={settings.autoDownloadUpdates}
              onCheckedChange={handleAutoDownloadChange}
              aria-label="Download updates automatically"
            />
            <span>Download updates automatically</span>
          </label>
        </SectionRow>
      </SectionFrame>
    )
  },
)
