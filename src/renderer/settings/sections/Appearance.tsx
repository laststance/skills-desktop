import React from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/renderer/src/components/ui/toggle-group'
import { useUnmountEffect } from '@/renderer/src/hooks/useUnmountEffect'
import { useUpdateEffect } from '@/renderer/src/hooks/useUpdateEffect'
import { useUpdateSettings } from '@/renderer/src/hooks/useUpdateSettings'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import {
  DEFAULT_SETTINGS,
  getWindowBackgroundOpacity,
  INSTALLED_SEARCH_COUNT_DISPLAY_OPTIONS as INSTALLED_SEARCH_COUNT_DISPLAY_VALUES,
  WINDOW_BACKGROUND_BLUR_MAX_RADIUS,
  WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
} from '@/shared/settings'
import type { Settings } from '@/shared/settings'

import { SectionFrame, SectionRow } from './SectionFrame'

const BACKGROUND_BLUR_LABEL = 'Opacity / Blur'
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

interface BackgroundBlurRangeInputProps {
  value: number
  label: string
  onBlurRadiusChange: (value: number) => void
}

/**
 * Native range control for the Electron background blur setting.
 * @param value - Current persisted blur radius in CSS pixels.
 * @param label - Accessible label that matches the visible setting row.
 * @param onBlurRadiusChange - Emits a numeric radius after input changes.
 * @returns Slider input sized to fit the Settings row.
 * @example
 * <BackgroundBlurRangeInput value={24} label="Opacity / Blur" onBlurRadiusChange={setRadius} />
 */
const BackgroundBlurRangeInput = React.memo(function BackgroundBlurRangeInput({
  value,
  label,
  onBlurRadiusChange,
}: BackgroundBlurRangeInputProps): React.ReactElement {
  const handleInputChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    // Native range input emits strings; Zod validates the final integer at IPC.
    const nextRadius = parseInt(event.currentTarget.value, 10)
    if (Number.isNaN(nextRadius)) return
    onBlurRadiusChange(nextRadius)
  }

  return (
    <input
      type="range"
      min={WINDOW_BACKGROUND_BLUR_MIN_RADIUS}
      max={WINDOW_BACKGROUND_BLUR_MAX_RADIUS}
      step={1}
      value={value}
      onChange={handleInputChange}
      aria-label={label}
      className="h-2 min-w-0 flex-1 accent-primary rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    />
  )
})

/**
 * Appearance pane for visual controls backed by persisted Settings.
 *
 * The first real control is the Electron 42 background blur radius. The same
 * slider also lowers the app-surface opacity, so users see an immediate
 * opacity/blur change instead of a fixed 85% backplate.
 */
export const Appearance = React.memo(function Appearance(): React.ReactElement {
  const windowBackgroundBlurRadius = useAppSelector(
    (state) => state.settings.windowBackgroundBlurRadius,
  )
  const installedSearchCountDisplay = useAppSelector(
    (state) => state.settings.installedSearchCountDisplay,
  )
  const updateSettings = useUpdateSettings()
  const [blurRadiusDraft, setBlurRadiusDraft] = React.useState<number>(
    windowBackgroundBlurRadius,
  )
  const persistTimerRef = React.useRef<number | null>(null)

  const clearPersistTimer = React.useCallback((): void => {
    if (persistTimerRef.current === null) return
    window.clearTimeout(persistTimerRef.current)
    persistTimerRef.current = null
  }, [])

  const persistBlurRadius = React.useCallback(
    (nextRadius: number): void => {
      clearPersistTimer()
      persistTimerRef.current = window.setTimeout(() => {
        updateSettings({ windowBackgroundBlurRadius: nextRadius })
        persistTimerRef.current = null
      }, 120)
    },
    [clearPersistTimer, updateSettings],
  )

  const handleBlurRadiusChange = React.useCallback(
    (nextRadius: number): void => {
      setBlurRadiusDraft(nextRadius)
      persistBlurRadius(nextRadius)
    },
    [persistBlurRadius],
  )

  const handleResetBlurRadius = React.useCallback((): void => {
    clearPersistTimer()
    setBlurRadiusDraft(DEFAULT_SETTINGS.windowBackgroundBlurRadius)
    updateSettings({
      windowBackgroundBlurRadius: DEFAULT_SETTINGS.windowBackgroundBlurRadius,
    })
  }, [clearPersistTimer, updateSettings])

  const handleSearchCountDisplayChange = React.useCallback(
    (nextValue: string): void => {
      if (nextValue !== 'tab' && nextValue !== 'inline') return
      updateSettings({ installedSearchCountDisplay: nextValue })
    },
    [updateSettings],
  )

  useUpdateEffect(() => {
    clearPersistTimer()
    setBlurRadiusDraft(windowBackgroundBlurRadius)
  }, [windowBackgroundBlurRadius, clearPersistTimer])

  useUnmountEffect(() => {
    clearPersistTimer()
  })

  const backgroundOpacityPercent = Math.round(
    getWindowBackgroundOpacity(blurRadiusDraft) * 100,
  )
  const blurRadiusLabel =
    blurRadiusDraft === WINDOW_BACKGROUND_BLUR_MIN_RADIUS
      ? 'Opaque'
      : `${backgroundOpacityPercent}% / ${blurRadiusDraft}px`
  const isDefaultBlurRadius =
    blurRadiusDraft === DEFAULT_SETTINGS.windowBackgroundBlurRadius

  return (
    <SectionFrame
      title="Appearance"
      description="Visual options for the main window."
    >
      <SectionRow
        label={INSTALLED_SEARCH_COUNT_DISPLAY_LABEL}
        description="Choose where the current Installed result count appears."
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          className="justify-start"
          value={installedSearchCountDisplay}
          onValueChange={handleSearchCountDisplayChange}
          aria-label={INSTALLED_SEARCH_COUNT_DISPLAY_LABEL}
        >
          {INSTALLED_SEARCH_COUNT_DISPLAY_OPTIONS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SectionRow>

      <SectionRow
        label={BACKGROUND_BLUR_LABEL}
        description="Surface opacity and background blur for the main window."
      >
        <div className="flex max-w-md flex-col gap-2">
          <div className="flex items-center gap-3">
            <BackgroundBlurRangeInput
              value={blurRadiusDraft}
              label={BACKGROUND_BLUR_LABEL}
              onBlurRadiusChange={handleBlurRadiusChange}
            />
            <span className="w-20 whitespace-nowrap text-right text-sm tabular-nums text-muted-foreground">
              {blurRadiusLabel}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetBlurRadius}
            disabled={isDefaultBlurRadius}
            className="w-fit"
          >
            Reset to default
          </Button>
        </div>
      </SectionRow>
    </SectionFrame>
  )
})
