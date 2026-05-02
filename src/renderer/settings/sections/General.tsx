import { Files, Info } from 'lucide-react'
import React from 'react'

import type { Settings } from '../../../shared/settings'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '../../src/components/ui/toggle-group'
import { useAppDispatch, useAppSelector } from '../../src/redux/hooks'
import { setSettings } from '../../src/redux/slices/settingsSlice'

import { SectionFrame, SectionRow } from './SectionFrame'

/**
 * Default tab values mirror the `Settings['defaultSkillTab']` union.
 * Both this control and `SkillDetail`'s tab buttons write to the same
 * settings field — the most recently chosen tab is the default on next
 * app open.
 */
const DEFAULT_TAB_OPTIONS: ReadonlyArray<{
  value: Settings['defaultSkillTab']
  label: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { value: 'files', label: 'Files', icon: Files },
  { value: 'info', label: 'Info', icon: Info },
]

/**
 * General settings pane.
 *
 * Currently ships the single real setting in the v0.15.0 Settings shell:
 * "Default tab when opening a skill". Other knobs (e.g. compact density,
 * auto-collapse) belong here in future PRs once their behavior is wired.
 *
 * Dispatch flow on change:
 *  1. Dispatch `setSettings` locally for instant UI feedback (no
 *     waiting on IPC for the radio to highlight).
 *  2. Fire `settings:set` IPC. Main writes the JSON atomically and
 *     broadcasts `settings:changed` back to every window including
 *     this one — the listener dispatches `setSettings` a second time
 *     with the same payload (idempotent replace).
 *
 * The optimistic local dispatch is safe because IPC to the same process
 * doesn't fail in practice; if main throws, the cache stays stale until
 * the next broadcast or window reload, which is acceptable for a
 * non-critical setting.
 */
export const General = React.memo(function General(): React.ReactElement {
  const dispatch = useAppDispatch()
  const settings = useAppSelector((state) => state.settings)

  const handleDefaultTabChange = (nextValue: string): void => {
    if (nextValue !== 'files' && nextValue !== 'info') return
    const nextSettings: Settings = {
      ...settings,
      defaultSkillTab: nextValue,
    }
    dispatch(setSettings(nextSettings))
    void window.electron.settings.set({ defaultSkillTab: nextValue })
  }

  return (
    <SectionFrame
      title="General"
      description="Behavior knobs that apply across the app."
    >
      <SectionRow
        label="Default tab when opening a skill"
        description="Which tab the right pane lands on when you select a skill."
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={settings.defaultSkillTab}
          onValueChange={handleDefaultTabChange}
          aria-label="Default tab when opening a skill"
        >
          {DEFAULT_TAB_OPTIONS.map((option) => {
            const Icon = option.icon
            return (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                aria-label={option.label}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{option.label}</span>
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
      </SectionRow>
    </SectionFrame>
  )
})
