import React from 'react'

import { SegmentedControl } from '@/renderer/src/components/shared/segmented-control'
import { Button } from '@/renderer/src/components/ui/button'
import { useDraftRangeSetting } from '@/renderer/src/hooks/useDraftRangeSetting'
import { useUpdateSettings } from '@/renderer/src/hooks/useUpdateSettings'
import { cn } from '@/renderer/src/lib/utils'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import { selectPreviewAppearanceSettings } from '@/renderer/src/redux/slices/settingsSlice'
import {
  CODE_THEME_DEFINITIONS,
  CODE_THEME_IDS,
  WINDOW_OPACITY_MAX_PERCENT,
  WINDOW_OPACITY_MIN_PERCENT,
  SETTINGS_RANGE_DEBOUNCE_MS,
  WINDOW_OPACITY_MODE_OPTIONS,
} from '@/shared/constants'
import type { CodeThemeId } from '@/shared/constants'
import {
  CODE_FONT_SIZE_DEFAULT_PX,
  CODE_FONT_SIZE_MAX_PX,
  CODE_FONT_SIZE_MIN_PX,
  DEFAULT_SETTINGS,
  INSTALLED_SEARCH_COUNT_DISPLAY_OPTIONS as INSTALLED_SEARCH_COUNT_DISPLAY_VALUES,
  MARKDOWN_FONT_SIZE_DEFAULT_PX,
  MARKDOWN_FONT_SIZE_MAX_PX,
  MARKDOWN_FONT_SIZE_MIN_PX,
} from '@/shared/settings'
import type { Settings } from '@/shared/settings'

import { BackgroundSettings } from '../backgrounds/BackgroundSettings'
import { WINDOW_OPACITY_LABELS } from '../backgrounds/constants'

import { SectionFrame, SectionRow } from './SectionFrame'

const OPACITY_MODE_LABELS: Record<Settings['windowOpacityMode'], string> = {
  entire: 'Entire',
  section: 'Section',
}
const OPACITY_MODE_DESCRIPTIONS: Record<Settings['windowOpacityMode'], string> =
  {
    entire: 'Adjust the background across the main window. Text stays clear.',
    section: 'Adjust each background independently. Text stays clear.',
  }
const OPACITY_MODE_CHOICES = WINDOW_OPACITY_MODE_OPTIONS.map((value) => ({
  value,
  label: OPACITY_MODE_LABELS[value],
}))
const SECTION_OPACITY_CONTROLS = [
  { key: 'leftSectionOpacityPercent', label: 'Left' },
  { key: 'centerSectionOpacityPercent', label: 'Center' },
  { key: 'rightSectionOpacityPercent', label: 'Right' },
] as const
const MARKDOWN_FONT_SIZE_LABEL = 'Reading font size'
const CODE_FONT_SIZE_LABEL = 'Code font size'
const CODE_THEME_LABEL = 'Code theme'
const INSTALLED_SEARCH_COUNT_DISPLAY_LABEL = 'Installed search count'
const INSTALLED_SEARCH_COUNT_DISPLAY_LABELS: Record<
  Settings['installedSearchCountDisplay'],
  string
> = {
  tab: 'Tab badge',
  inline: 'Toolbar text',
}
const INSTALLED_SEARCH_COUNT_DISPLAY_OPTIONS =
  INSTALLED_SEARCH_COUNT_DISPLAY_VALUES.map((value) => ({
    value,
    label: INSTALLED_SEARCH_COUNT_DISPLAY_LABELS[value],
  }))

/**
 * Format a font-size slider's value badge.
 * @param fontSizePx - Current draft font size.
 * @returns Pixel-suffixed display string.
 * @example
 * formatPxValue(14) // => '14px'
 */
function formatPxValue(fontSizePx: number): string {
  return `${fontSizePx}px`
}

interface SettingRangeInputProps {
  value: number
  min: number
  max: number
  label: string
  valueText: string
  onValueChange: (value: number) => void
  onValueCommit: () => void
}

/**
 * Native range control shared by the appearance sliders (opacity, font sizes).
 * @param value - Current draft value.
 * @param min - Slider lower bound.
 * @param max - Slider upper bound.
 * @param label - Accessible label matching the visible setting row.
 * @param valueText - Visible value announced to screen readers (e.g. '100%', '14px').
 * @param onValueChange - Emits the parsed integer after each input change.
 * @param onValueCommit - Flushes the pending value when the pointer, keyboard or focus interaction ends.
 * @returns Slider input sized to fit the Settings row.
 * @example
 * <SettingRangeInput value={14} min={12} max={22} label="Reading font size" valueText="14px" onValueChange={setSize} onValueCommit={flushSize} />
 */
const SettingRangeInput = function SettingRangeInput({
  value,
  min,
  max,
  label,
  valueText,
  onValueChange,
  onValueCommit,
}: SettingRangeInputProps): React.ReactElement {
  const handleInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    // Native range input emits strings; Zod validates the final integer at IPC.
    const nextValue = parseInt(event.currentTarget.value, 10)
    /* v8 ignore next -- a native range input always emits a numeric string, so parseInt() never returns NaN here */
    if (Number.isNaN(nextValue)) return
    onValueChange(nextValue)
  }

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={1}
      value={value}
      onChange={handleInputChange}
      onPointerUp={onValueCommit}
      onKeyUp={onValueCommit}
      onBlur={onValueCommit}
      aria-label={label}
      aria-valuetext={valueText}
      className="h-6 min-w-0 flex-1 accent-primary rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    />
  )
}

interface RangeSettingControlProps {
  label: string
  min: number
  max: number
  draft: number
  isDefault: boolean
  isCompact?: boolean
  formatValue: (value: number) => string
  onValueChange: (value: number) => void
  onValueCommit: () => void
  onReset: () => void
}

/**
 * Slider + live value badge + "Reset to default" row, shared by every
 * appearance range setting so the three sliders stay visually identical.
 * @param label - Accessible/visible control label.
 * @param min - Slider lower bound.
 * @param max - Slider upper bound.
 * @param draft - Current draft value driving slider + badge.
 * @param isDefault - Disables Reset when the draft already equals the default.
 * @param isCompact - Keeps the value and reset inline for the three comparable Section sliders.
 * @param formatValue - Renders the value badge text.
 * @param onValueChange - Slider change handler.
 * @param onValueCommit - Saves the final draft at the end of a slider interaction.
 * @param onReset - Reset-to-default handler.
 * @returns The composed control column.
 * @example
 * <RangeSettingControl label="Code font size" min={11} max={20} draft={13} isDefault formatValue={formatPxValue} onValueChange={fn} onValueCommit={flush} onReset={fn} />
 */
const RangeSettingControl = function RangeSettingControl({
  label,
  min,
  max,
  draft,
  isDefault,
  isCompact = false,
  formatValue,
  onValueChange,
  onValueCommit,
  onReset,
}: RangeSettingControlProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex max-w-md gap-2',
        isCompact ? 'items-center' : 'flex-col',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SettingRangeInput
          value={draft}
          min={min}
          max={max}
          label={label}
          valueText={formatValue(draft)}
          onValueChange={onValueChange}
          onValueCommit={onValueCommit}
        />

        <span
          className={cn(
            'shrink-0 whitespace-nowrap text-right text-sm tabular-nums text-muted-foreground',
            isCompact ? 'w-10' : 'w-20',
          )}
        >
          {formatValue(draft)}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onReset}
        disabled={isDefault}
        className="w-fit shrink-0"
        aria-label={`Reset to default: ${label}`}
      >
        {isCompact ? 'Reset' : 'Reset to default'}
      </Button>
    </div>
  )
}

interface CodeThemeSelectProps {
  value: CodeThemeId
  onValueChange: (value: CodeThemeId) => void
}

/**
 * Native picker for the curated Shiki code-preview theme. Native `<select>`
 * (matching General's terminal picker) keeps all five named themes compact
 * without overflowing the row the way a five-item segmented control would.
 * @param value - Currently selected theme id.
 * @param onValueChange - Emits the chosen theme id.
 * @returns Theme select control.
 * @example
 * <CodeThemeSelect value="github" onValueChange={setTheme} />
 */
const CodeThemeSelect = function CodeThemeSelect({
  value,
  onValueChange,
}: CodeThemeSelectProps): React.ReactElement {
  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>): void => {
    // `find` narrows the readonly tuple to CodeThemeId without an `as` cast;
    // the IPC schema (`z.enum(CODE_THEME_IDS)`) is the real trust boundary.
    const next = CODE_THEME_IDS.find((id) => id === event.target.value)
    /* v8 ignore next -- the <select> renders only CODE_THEME_DEFINITIONS options and CODE_THEME_IDS is built from them, so find() never returns undefined */
    if (!next) return
    onValueChange(next)
  }

  return (
    <select
      className="h-9 min-w-56 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
      value={value}
      onChange={handleChange}
      aria-label={CODE_THEME_LABEL}
    >
      {CODE_THEME_DEFINITIONS.map((theme) => (
        <option key={theme.id} value={theme.id}>
          {theme.label}
        </option>
      ))}
    </select>
  )
}

/**
 * Appearance pane for visual controls backed by persisted Settings: the
 * Background-only transparency, the file
 * preview typography (Markdown reading size, code size, code theme), and where
 * the Installed result count is shown.
 */
export const Appearance = function Appearance(): React.ReactElement {
  const windowBackgroundOpacityPercent = useAppSelector(
    (state) => state.settings.windowBackgroundOpacityPercent,
  )
  const windowOpacityMode = useAppSelector(
    (state) => state.settings.windowOpacityMode,
  )
  const { markdownFontSizePx, codeFontSizePx, codeThemeId } = useAppSelector(
    selectPreviewAppearanceSettings,
  )
  const installedSearchCountDisplay = useAppSelector(
    (state) => state.settings.installedSearchCountDisplay,
  )
  const updateSettings = useUpdateSettings()

  const opacity = useDraftRangeSetting(
    windowBackgroundOpacityPercent,
    DEFAULT_SETTINGS.windowBackgroundOpacityPercent,
    (percent) => updateSettings({ windowBackgroundOpacityPercent: percent }),
    SETTINGS_RANGE_DEBOUNCE_MS,
  )
  const markdownFont = useDraftRangeSetting(
    markdownFontSizePx,
    MARKDOWN_FONT_SIZE_DEFAULT_PX,
    (fontSizePx) => updateSettings({ markdownFontSizePx: fontSizePx }),
    SETTINGS_RANGE_DEBOUNCE_MS,
  )
  const codeFont = useDraftRangeSetting(
    codeFontSizePx,
    CODE_FONT_SIZE_DEFAULT_PX,
    (fontSizePx) => updateSettings({ codeFontSizePx: fontSizePx }),
    SETTINGS_RANGE_DEBOUNCE_MS,
  )

  const handleSearchCountDisplayChange = (
    nextValue: Settings['installedSearchCountDisplay'],
  ): void => {
    updateSettings({ installedSearchCountDisplay: nextValue })
  }

  const handleCodeThemeChange = (nextThemeId: CodeThemeId): void => {
    updateSettings({ codeThemeId: nextThemeId })
  }

  return (
    <SectionFrame
      title="Appearance"
      description="Visual options for the main window."
    >
      <SectionRow
        label={INSTALLED_SEARCH_COUNT_DISPLAY_LABEL}
        description="Choose where the current Installed result count appears."
      >
        <SegmentedControl
          aria-label={INSTALLED_SEARCH_COUNT_DISPLAY_LABEL}
          size="sm"
          value={installedSearchCountDisplay}
          onValueChange={handleSearchCountDisplayChange}
          options={INSTALLED_SEARCH_COUNT_DISPLAY_OPTIONS}
        />
      </SectionRow>

      <BackgroundSettings />

      <SectionRow label="Opacity">
        <SegmentedControl
          aria-label="Opacity mode"
          size="sm"
          value={windowOpacityMode}
          onValueChange={(nextMode) =>
            updateSettings({ windowOpacityMode: nextMode })
          }
          options={OPACITY_MODE_CHOICES}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {OPACITY_MODE_DESCRIPTIONS[windowOpacityMode]}
        </p>
        {/* Keep both modes mounted so switching retains drafts and pending saves. */}
        <div hidden={windowOpacityMode !== 'entire'} className="mt-4">
          <RangeSettingControl
            label={WINDOW_OPACITY_LABELS.windowBackgroundOpacityPercent}
            min={WINDOW_OPACITY_MIN_PERCENT}
            max={WINDOW_OPACITY_MAX_PERCENT}
            draft={opacity.draft}
            isDefault={opacity.isDefault}
            formatValue={formatOpacityPercent}
            onValueChange={opacity.change}
            onValueCommit={opacity.flush}
            onReset={opacity.reset}
          />
        </div>
        <div
          hidden={windowOpacityMode !== 'section'}
          className="mt-4 space-y-4"
        >
          {SECTION_OPACITY_CONTROLS.map((control) => (
            <SectionOpacityControl key={control.key} control={control} />
          ))}
        </div>
      </SectionRow>

      <SectionRow
        label={MARKDOWN_FONT_SIZE_LABEL}
        description="Body text size for the Markdown reading view; headings and code scale with it."
      >
        <RangeSettingControl
          label={MARKDOWN_FONT_SIZE_LABEL}
          min={MARKDOWN_FONT_SIZE_MIN_PX}
          max={MARKDOWN_FONT_SIZE_MAX_PX}
          draft={markdownFont.draft}
          isDefault={markdownFont.isDefault}
          formatValue={formatPxValue}
          onValueChange={markdownFont.change}
          onValueCommit={markdownFont.flush}
          onReset={markdownFont.reset}
        />
      </SectionRow>

      <SectionRow
        label={CODE_FONT_SIZE_LABEL}
        description="Font size for the syntax-highlighted code preview."
      >
        <RangeSettingControl
          label={CODE_FONT_SIZE_LABEL}
          min={CODE_FONT_SIZE_MIN_PX}
          max={CODE_FONT_SIZE_MAX_PX}
          draft={codeFont.draft}
          isDefault={codeFont.isDefault}
          formatValue={formatPxValue}
          onValueChange={codeFont.change}
          onValueCommit={codeFont.flush}
          onReset={codeFont.reset}
        />
      </SectionRow>

      <SectionRow
        label={CODE_THEME_LABEL}
        description="Syntax highlighting theme for the code preview (light/dark matches the app)."
      >
        <CodeThemeSelect
          value={codeThemeId}
          onValueChange={handleCodeThemeChange}
        />
      </SectionRow>
    </SectionFrame>
  )
}

/**
 * Persists one independently resettable section slider when Appearance renders its Section controls.
 * @param control - Saved numeric field and its visible section label.
 * @returns Labeled opacity slider with a percentage and reset action.
 * @example <SectionOpacityControl control={{ key: 'leftSectionOpacityPercent', label: 'Left' }} />
 */
function SectionOpacityControl({
  control,
}: {
  control: (typeof SECTION_OPACITY_CONTROLS)[number]
}): React.ReactElement {
  const opacityPercent = useAppSelector((state) => state.settings[control.key])
  const updateSettings = useUpdateSettings()
  const opacity = useDraftRangeSetting(
    opacityPercent,
    WINDOW_OPACITY_MAX_PERCENT,
    (nextPercent) => updateSettings({ [control.key]: nextPercent }),
    SETTINGS_RANGE_DEBOUNCE_MS,
  )

  return (
    <div className="grid max-w-md grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3">
      <div className="text-sm font-medium">{control.label}</div>
      <RangeSettingControl
        isCompact
        label={WINDOW_OPACITY_LABELS[control.key]}
        min={WINDOW_OPACITY_MIN_PERCENT}
        max={WINDOW_OPACITY_MAX_PERCENT}
        draft={opacity.draft}
        isDefault={opacity.isDefault}
        formatValue={formatOpacityPercent}
        onValueChange={opacity.change}
        onValueCommit={opacity.flush}
        onReset={opacity.reset}
      />
    </div>
  )
}

/**
 * Labels section slider values when Appearance updates a draft or announces it to assistive technology.
 * @param opacityPercent - Current section opacity percentage.
 * @returns Percentage shown beside the slider.
 * @example formatOpacityPercent(85) // '85%'
 */
function formatOpacityPercent(opacityPercent: number): string {
  return `${opacityPercent}%`
}
