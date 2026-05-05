import { Files, Info } from 'lucide-react'
import React, { useState } from 'react'

import { Input } from '@/renderer/src/components/ui/input'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/renderer/src/components/ui/toggle-group'
import { useUpdateSettings } from '@/renderer/src/hooks/useUpdateSettings'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import { TERMINAL_APP_IDS, TERMINAL_APP_UI_LABELS } from '@/shared/constants'
import type { Settings } from '@/shared/settings'

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
 * Length cap mirrors `SettingsSchema.customTerminalAppName.max(64)` and the
 * IPC schema in `src/main/ipc/ipc-schemas.ts`. Surfacing the limit on the
 * `<input maxLength>` keeps the user from typing past the boundary instead
 * of getting a silent reject after blur.
 */
const CUSTOM_APP_NAME_MAX_LENGTH = 64

/**
 * General settings pane.
 *
 * Currently ships:
 *  - "Default tab when opening a skill" (existing).
 *  - "Preferred terminal" — which macOS terminal "Open in Terminal" launches.
 *    `'custom'` reveals a free-form input that's persisted as
 *    `customTerminalAppName`.
 *
 * Dispatch flow on change (mirrors `defaultSkillTab`):
 *  1. Local optimistic dispatch via `useUpdateSettings` for instant feedback.
 *  2. IPC `settings:set` — main writes JSON atomically + broadcasts
 *     `settings:changed` to every window.
 *
 * The custom-app-name input intentionally does NOT fire IPC on every
 * keystroke. We commit on `blur` (focus leaves the field) so an atomic
 * disk write doesn't happen on each keypress — that would be a footgun
 * for users typing slowly and would also fan out a `settings:changed`
 * broadcast to every open window per character.
 */
export const General = React.memo(function General(): React.ReactElement {
  const settings = useAppSelector((state) => state.settings)
  const updateSettings = useUpdateSettings()

  // Local mirror of the custom name field so users can type without
  // committing on every keystroke. Initial value is whatever's in settings
  // (which itself was last committed via blur). Reset implicitly on
  // re-mount; explicit reset on settings change isn't needed because the
  // field is only visible while preferredTerminal === 'custom'.
  const [customNameDraft, setCustomNameDraft] = useState<string>(
    settings.customTerminalAppName ?? '',
  )

  const handleDefaultTabChange = (nextValue: string): void => {
    if (nextValue !== 'files' && nextValue !== 'info') return
    updateSettings({ defaultSkillTab: nextValue })
  }

  const handlePreferredTerminalChange = (
    e: React.ChangeEvent<HTMLSelectElement>,
  ): void => {
    // `find` infers `TerminalAppId | undefined` from the readonly tuple, so
    // the IPC dispatcher is narrowed without an `as` cast. The IPC schema
    // (`z.enum(TERMINAL_APP_IDS)`) is the real trust boundary — this filter
    // is only here so a tampered DOM can't tunnel a bad string in.
    const next = TERMINAL_APP_IDS.find((id) => id === e.target.value)
    if (!next) return
    updateSettings({ preferredTerminal: next })
  }

  /**
   * Commit the trimmed draft on blur. Empty string after trim → skip the
   * IPC call (keeps prior value) so leaving the field blank doesn't wipe
   * what the user previously saved. Same trim/min(1) guard as the Zod
   * schema so the renderer never asks main to write a value that the
   * schema would reject.
   */
  const handleCustomNameBlur = (): void => {
    const trimmed = customNameDraft.trim()
    if (trimmed === '') return
    if (trimmed === settings.customTerminalAppName) return
    updateSettings({ customTerminalAppName: trimmed })
  }

  const isCustom = settings.preferredTerminal === 'custom'
  const isDraftBlank = customNameDraft.trim() === ''

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

      <SectionRow
        label="Preferred terminal"
        description='Which app "Open in Terminal" launches for skill folders.'
      >
        <div className="flex flex-col gap-2">
          {/* Native <select> instead of shadcn — fewer deps, native macOS */}
          {/* popover menu, free type-to-search and arrow-key nav. Sized to */}
          {/* fit longest label ("Terminal (Apple)") at the chosen text size. */}
          <select
            className="h-9 min-w-[14rem] rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            value={settings.preferredTerminal}
            onChange={handlePreferredTerminalChange}
            aria-label="Preferred terminal"
          >
            {TERMINAL_APP_IDS.map((id) => (
              <option key={id} value={id}>
                {TERMINAL_APP_UI_LABELS[id]}
              </option>
            ))}
          </select>

          {isCustom && (
            <div className="flex flex-col gap-1">
              <Input
                type="text"
                value={customNameDraft}
                onChange={(e) => setCustomNameDraft(e.target.value)}
                onBlur={handleCustomNameBlur}
                placeholder="e.g. Hyper"
                maxLength={CUSTOM_APP_NAME_MAX_LENGTH}
                aria-label="Custom terminal app name"
                className="min-w-[14rem]"
              />
              {isDraftBlank ? (
                <p className="text-xs text-muted-foreground">
                  Enter the macOS app name (e.g. <code>Hyper</code>). The app
                  must be installed in <code>/Applications</code>.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Saved when you click outside the field.
                </p>
              )}
            </div>
          )}

          {/* Footnote disclosure: some terminals (Warp Stable, Ghostty) */}
          {/* don't honor `cwd` from the macOS `open -a` flag and may */}
          {/* launch at $HOME instead of the requested folder. We can't */}
          {/* fix that from our side — surface it so the user isn't surprised. */}
          <p className="text-xs text-muted-foreground">
            Note: some terminals (Warp, Ghostty) may open at your home directory
            instead of the skill folder.
          </p>
        </div>
      </SectionRow>
    </SectionFrame>
  )
})
