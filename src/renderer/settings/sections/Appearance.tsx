import React, { useCallback } from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import { SegmentedControl } from '@/renderer/src/components/ui/segmented-control'
import { useDraftRangeSetting } from '@/renderer/src/hooks/useDraftRangeSetting'
import { useUpdateSettings } from '@/renderer/src/hooks/useUpdateSettings'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import {
  CODE_THEME_DEFINITIONS,
  CODE_THEME_IDS,
  SETTINGS_RANGE_DEBOUNCE_MS,
} from '@/shared/constants'
import type { CodeThemeId } from '@/shared/constants'
import {
  CODE_FONT_SIZE_DEFAULT_PX,
  CODE_FONT_SIZE_MAX_PX,
  CODE_FONT_SIZE_MIN_PX,
  DEFAULT_SETTINGS,
  getWindowBackgroundOpacity,
  INSTALLED_SEARCH_COUNT_DISPLAY_OPTIONS as INSTALLED_SEARCH_COUNT_DISPLAY_VALUES,
  MARKDOWN_FONT_SIZE_DEFAULT_PX,
  MARKDOWN_FONT_SIZE_MAX_PX,
  MARKDOWN_FONT_SIZE_MIN_PX,
  WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
  WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
} from '@/shared/settings'
import type { Settings } from '@/shared/settings'

import { SectionFrame, SectionRow } from './SectionFrame'

const BACKGROUND_BLUR_LABEL = 'Opacity / Blur'
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
 * Format the blur slider's value badge: fully opaque reads "Opaque", otherwise
 * the surface opacity percent plus the blur radius in px.
 * @param blurRadius - Current draft blur radius.
 * @returns Display string for the value badge.
 * @example
 * formatBlurValue(0)  // => 'Opaque'
 * formatBlurValue(24) // => '72% / 24px'
 */
function formatBlurValue(blurRadius: number): string {
  if (blurRadius === WINDOW_BACKGROUND_BLUR_MIN_RADIUS) return 'Opaque'
  const opacityPercent = Math.round(
    getWindowBackgroundOpacity(blurRadius) * 100,
  )
  return `${opacityPercent}% / ${blurRadius}px`
}

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
}

/**
 * Native range control shared by the appearance sliders (blur, font sizes).
 * @param value - Current draft value.
 * @param min - Slider lower bound.
 * @param max - Slider upper bound.
 * @param label - Accessible label matching the visible setting row.
 * @param valueText - Human-readable value announced to screen readers (e.g. 'Opaque', '14px') so AT speaks the visible badge instead of the raw integer.
 * @param onValueChange - Emits the parsed integer after each input change.
 * @returns Slider input sized to fit the Settings row.
 * @example
 * <SettingRangeInput value={14} min={12} max={22} label="Reading font size" valueText="14px" onValueChange={setSize} />
 */
const SettingRangeInput = React.memo(function SettingRangeInput({
  value,
  min,
  max,
  label,
  valueText,
  onValueChange,
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
      aria-label={label}
      aria-valuetext={valueText}
      className="h-2 min-w-0 flex-1 accent-primary rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    />
  )
})

interface RangeSettingControlProps {
  label: string
  min: number
  max: number
  draft: number
  isDefault: boolean
  formatValue: (value: number) => string
  onValueChange: (value: number) => void
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
 * @param formatValue - Renders the value badge text.
 * @param onValueChange - Slider change handler.
 * @param onReset - Reset-to-default handler.
 * @returns The composed control column.
 * @example
 * <RangeSettingControl label="Code font size" min={11} max={20} draft={13} isDefault formatValue={formatPxValue} onValueChange={fn} onReset={fn} />
 */
const RangeSettingControl = React.memo(function RangeSettingControl({
  label,
  min,
  max,
  draft,
  isDefault,
  formatValue,
  onValueChange,
  onReset,
}: RangeSettingControlProps): React.ReactElement {
  return (
    <div className="flex max-w-md flex-col gap-2">
      <div className="flex items-center gap-3">
        <SettingRangeInput
          value={draft}
          min={min}
          max={max}
          label={label}
          valueText={formatValue(draft)}
          onValueChange={onValueChange}
        />
        <span className="w-20 whitespace-nowrap text-right text-sm tabular-nums text-muted-foreground">
          {formatValue(draft)}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onReset}
        disabled={isDefault}
        className="w-fit"
        aria-label={`Reset to default: ${label}`}
      >
        Reset to default
      </Button>
    </div>
  )
})

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
const CodeThemeSelect = React.memo(function CodeThemeSelect({
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
})

/**
 * Appearance pane for visual controls backed by persisted Settings: the
 * Electron background blur (which also drives app-surface opacity), the file
 * preview typography (Markdown reading size, code size, code theme), and where
 * the Installed result count is shown.
 */
export const Appearance = React.memo(function Appearance(): React.ReactElement {
  const windowBackgroundBlurRadius = useAppSelector(
    (state) => state.settings.windowBackgroundBlurRadius,
  )
  const markdownFontSizePx = useAppSelector(
    (state) => state.settings.markdownFontSizePx,
  )
  const codeFontSizePx = useAppSelector(
    (state) => state.settings.codeFontSizePx,
  )
  const codeThemeId = useAppSelector((state) => state.settings.codeThemeId)
  const installedSearchCountDisplay = useAppSelector(
    (state) => state.settings.installedSearchCountDisplay,
  )
  const updateSettings = useUpdateSettings()

  const blur = useDraftRangeSetting(
    windowBackgroundBlurRadius,
    DEFAULT_SETTINGS.windowBackgroundBlurRadius,
    (radius) => updateSettings({ windowBackgroundBlurRadius: radius }),
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

  const handleSearchCountDisplayChange = useCallback(
    (nextValue: Settings['installedSearchCountDisplay']): void => {
      updateSettings({ installedSearchCountDisplay: nextValue })
    },
    [updateSettings],
  )

  const handleCodeThemeChange = useCallback(
    (nextThemeId: CodeThemeId): void => {
      updateSettings({ codeThemeId: nextThemeId })
    },
    [updateSettings],
  )

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

      <SectionRow
        label={BACKGROUND_BLUR_LABEL}
        description="Surface opacity and background blur for the main window."
      >
        <RangeSettingControl
          label={BACKGROUND_BLUR_LABEL}
          min={WINDOW_BACKGROUND_BLUR_MIN_RADIUS}
          max={WINDOW_BACKGROUND_BLUR_MAX_RADIUS}
          draft={blur.draft}
          isDefault={blur.isDefault}
          formatValue={formatBlurValue}
          onValueChange={blur.change}
          onReset={blur.reset}
        />
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
})
