import React from 'react'

import { Checkbox } from '@/renderer/src/components/ui/checkbox'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/renderer/src/components/ui/toggle-group'

import { MockControl, SectionFrame, SectionRow } from './SectionFrame'

/**
 * Appearance pane — visual stub for v0.15.0.
 *
 * The shadcn theme presets are real and live in the main window, but
 * the user-facing density / compact-mode knobs are not yet wired to
 * Tailwind density variables. Shipping disabled controls (with a
 * "Coming in a future release" hover tooltip) here lets the Settings
 * shell preview the future shape without misleading users into
 * thinking the toggles do something today.
 */
export const Appearance = React.memo(function Appearance(): React.ReactElement {
  return (
    <SectionFrame
      title="Appearance"
      description="Density and visual options for the main window."
    >
      <SectionRow
        label="Density"
        description="How tightly rows pack in skill and marketplace lists."
      >
        <MockControl>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value="comfortable"
            disabled
            aria-label="Density"
            className="pointer-events-none"
          >
            <ToggleGroupItem value="comfortable" disabled>
              Comfortable
            </ToggleGroupItem>
            <ToggleGroupItem value="compact" disabled>
              Compact
            </ToggleGroupItem>
          </ToggleGroup>
        </MockControl>
      </SectionRow>
      <SectionRow
        label="Compact mode"
        description="Tighter padding across panels for smaller displays."
      >
        <MockControl>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox disabled />
            <span>Use compact spacing</span>
          </label>
        </MockControl>
      </SectionRow>
    </SectionFrame>
  )
})
