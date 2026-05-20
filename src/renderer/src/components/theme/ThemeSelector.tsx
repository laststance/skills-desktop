import { Monitor, Moon, Palette, Sun } from 'lucide-react'
import React, { useCallback, type ReactElement } from 'react'

import { Button } from '@/renderer/src/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/src/components/ui/dropdown-menu'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/renderer/src/components/ui/toggle-group'
import { cn } from '@/renderer/src/lib/utils'
import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import type { ModePreference } from '@/renderer/src/redux/slices/themeSlice'
import {
  setModePreference,
  setTheme,
} from '@/renderer/src/redux/slices/themeSlice'
import type { ThemePresetName } from '@/shared/constants'
import { THEME_PRESETS } from '@/shared/constants'

// Derive preset groups from THEME_PRESETS so adding a new hue in the
// constants table automatically surfaces in the dropdown. Neutral presets
// carry a baked-in `mode` field; color presets don't — that's the
// discriminator. `Object.keys` preserves insertion order per spec, so
// swatches render in the declaration order defined in THEME_PRESETS.
const PRESET_NAMES = Object.keys(THEME_PRESETS) as ThemePresetName[]
const COLOR_PRESET_NAMES = PRESET_NAMES.filter(
  (name) => !('mode' in THEME_PRESETS[name]),
)
const NEUTRAL_PRESET_NAMES = PRESET_NAMES.filter(
  (name) => 'mode' in THEME_PRESETS[name],
)

/**
 * OKLCH lightness for swatch dots in the dropdown. 0.65 sits in the
 * perceptual middle — light enough for dark backgrounds, dark enough for
 * light backgrounds — and matches the lightness used by `--primary` in
 * `globals.css`. Pulling it out of inline styles keeps the eight swatch
 * call sites in lockstep when designers retune the value.
 */
const SWATCH_LIGHTNESS = 0.65

/**
 * Tinted-neutral families surface in a single row of 5 swatches (no
 * Dark/Light split — picking the family swatch resolves to the partner
 * key that matches the user's currently displayed mode). This is the
 * shape `THEME_PRESETS` produces after grouping by family prefix.
 *
 * Family id is derived from the preset name's prefix (`zinc-dark` → `zinc`).
 * The label drops the "Dark"/"Light" suffix so the row reads as a horizontal
 * palette picker rather than a list of mode-locked entries.
 *
 * @example
 * NEUTRAL_FAMILIES === [
 *   { id: 'neutral', label: 'Neutral', dark: 'neutral-dark', light: 'neutral-light', hue: 0,   chroma: 0    },
 *   { id: 'zinc',    label: 'Zinc',    dark: 'zinc-dark',    light: 'zinc-light',    hue: 265, chroma: 0.05 },
 *   ...
 * ]
 */
interface NeutralFamily {
  id: string
  label: string
  dark: ThemePresetName | null
  light: ThemePresetName | null
  hue: number
  chroma: number
}

const NEUTRAL_FAMILIES: readonly NeutralFamily[] = (() => {
  const families = new Map<string, NeutralFamily>()
  for (const name of NEUTRAL_PRESET_NAMES) {
    const config = THEME_PRESETS[name]
    if (!('mode' in config)) continue
    // `name` is `<family>-<mode>`; the family id is the prefix and the
    // human label is the prefix capitalized (e.g. zinc → Zinc).
    const lastDash = name.lastIndexOf('-')
    const familyId = lastDash >= 0 ? name.slice(0, lastDash) : name
    const familyLabel = familyId.charAt(0).toUpperCase() + familyId.slice(1)
    const existing = families.get(familyId) ?? {
      id: familyId,
      label: familyLabel,
      dark: null,
      light: null,
      hue: config.hue,
      chroma: config.chroma,
    }
    if (config.mode === 'dark') existing.dark = name
    else existing.light = name
    families.set(familyId, existing)
  }
  return Array.from(families.values())
})()

/**
 * Build the live "current theme" string for the dropdown header.
 * Color presets are mode-agnostic in `THEME_PRESETS` (label = 'Sky'), so we
 * append the resolved mode for context. Neutral preset labels already
 * encode the mode (e.g. 'Zinc Dark'), so we use them verbatim.
 *
 * @example
 * formatCurrentThemeLabel('cyan',        'dark')  // 'Cyan · Dark'
 * formatCurrentThemeLabel('zinc-light',  'light') // 'Zinc Light'
 */
function formatCurrentThemeLabel(
  preset: ThemePresetName,
  mode: 'light' | 'dark',
): string {
  const config = THEME_PRESETS[preset]
  if ('mode' in config) return config.label
  return `${config.label} · ${mode === 'dark' ? 'Dark' : 'Light'}`
}

/**
 * Theme selector dropdown (Pattern 1: Mode-First Compact).
 *
 * Layout, top to bottom:
 *  1. Header — "Theme" label with the live current preset name on the right
 *     (mono, muted) so users always know what they're on without hunting
 *     for the highlighted swatch.
 *  2. Mode segmented control — single-select radiogroup of
 *     Light / Dark / Auto. "Auto" persists as `modePreference === 'system'`
 *     and follows `prefers-color-scheme` via the listener middleware.
 *  3. Accent — the 17 hue-based color presets as a 6-column swatch grid.
 *     Mode-agnostic; clicking keeps the user's current mode.
 *  4. Tinted Neutral — the 5 families (Neutral, Zinc, Slate, Stone, Mauve)
 *     as a single horizontal row of swatches with labels underneath. Each
 *     swatch resolves to `${family}-${currentMode}` so users don't have to
 *     pick a Dark/Light variant twice.
 *
 * Wrapped in `React.memo` to match the project-wide memoization convention
 * (enforced by `@laststance/react-next/all-memo`). The component takes no
 * props, so the referential stability is trivial — memo is for consistency
 * with every other component in the tree.
 */
export const ThemeSelector = React.memo(function ThemeSelector(): ReactElement {
  const dispatch = useAppDispatch()
  const { mode, modePreference, preset } = useAppSelector(
    (state) => state.theme,
  )

  // `useCallback` is intentionally avoided for `handleSelectPreset` and
  // `handleSelectFamily`: the swatch grid renders an inline arrow per item
  // (`() => dispatch(setTheme(name))`) to capture the per-item `name` /
  // `family`. Wrapping a stable `handleSelectPreset` and then re-wrapping
  // it in the inline arrow would defeat the memoization (enforced by the
  // `@laststance/react-next/no-deopt-use-callback` lint rule). The inline
  // arrow is the simplest correct form — each render creates 17 new
  // closures, which is fine at this scale.
  //
  // `handleSelectMode` is different: it is passed directly to Radix's
  // `onValueChange` (no per-item wrapper), so memoization sticks and pays
  // off when ToggleGroup memoizes against the prop identity.
  const handleSelectMode = useCallback(
    (value: string): void => {
      // Radix's `onValueChange` can fire with an empty string when the
      // user tries to deselect the active item — guard so we always have a
      // value; the segmented control should never enter an "unset" state.
      if (!value) return
      dispatch(setModePreference(value as ModePreference))
    },
    [dispatch],
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-11 w-11"
          aria-label="Theme and color options"
        >
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/* Header: section title + live current preset name. Mono + muted so
         * the active preset reads as metadata rather than competing with the
         * controls below. */}
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Theme</span>
          <span
            className="font-mono text-xs text-muted-foreground"
            aria-live="polite"
          >
            {formatCurrentThemeLabel(preset, mode)}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Mode segmented control. Radix ToggleGroup with type="single"
         * exposes a `radiogroup` role; each item is `role="radio"`. */}
        <div className="px-1 py-1">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={modePreference}
            onValueChange={handleSelectMode}
            className="w-full"
            aria-label="Color mode"
          >
            <ToggleGroupItem
              value="light"
              aria-label="Light mode"
              className="flex-1"
            >
              <Sun className="h-3.5 w-3.5" />
              Light
            </ToggleGroupItem>
            <ToggleGroupItem
              value="dark"
              aria-label="Dark mode"
              className="flex-1"
            >
              <Moon className="h-3.5 w-3.5" />
              Dark
            </ToggleGroupItem>
            <ToggleGroupItem
              value="system"
              aria-label="System mode"
              className="flex-1"
            >
              <Monitor className="h-3.5 w-3.5" />
              Auto
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <DropdownMenuSeparator />

        {/* Accent — chroma > 0, hue varies. Mode-agnostic. */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Accent
        </DropdownMenuLabel>
        <div className="grid grid-cols-6 gap-0.5 p-1">
          {COLOR_PRESET_NAMES.map((name) => {
            const config = THEME_PRESETS[name]
            const isSelected = preset === name
            return (
              <button
                key={name}
                type="button"
                onClick={() => dispatch(setTheme(name))}
                className="min-h-11 min-w-11 flex items-center justify-center"
                title={config.label}
                aria-label={`Select ${config.label} theme`}
                aria-pressed={isSelected}
              >
                <span
                  className={cn(
                    'h-6 w-6 rounded-full transition-transform hover:scale-110 block',
                    isSelected &&
                      'ring-2 ring-white ring-offset-2 ring-offset-background',
                  )}
                  style={{
                    backgroundColor: `oklch(${SWATCH_LIGHTNESS} ${config.chroma} ${config.hue})`,
                  }}
                />
              </button>
            )
          })}
        </div>

        <DropdownMenuSeparator />

        {/* Tinted Neutral — 5 families × 1 swatch (no Dark/Light split).
         * The previous design rendered 5 × 2 = 10 mode-locked buttons,
         * which forced users to re-pick the mode every time they switched
         * family. Pattern 1 collapses the row to one button per family
         * and resolves the dark/light partner from `state.mode` so the
         * mode segmented control above stays the single source of truth
         * for light vs dark. */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Tinted Neutral
        </DropdownMenuLabel>
        <div className="flex items-stretch gap-0.5 p-1">
          {NEUTRAL_FAMILIES.map((family) => {
            const isSelected = preset === family.dark || preset === family.light
            // Family swatches resolve to the partner preset matching the
            // user's currently displayed mode so picking "Zinc" while in
            // Dark goes to zinc-dark without forcing a mode flip the user
            // didn't ask for.
            const targetPreset = mode === 'dark' ? family.dark : family.light
            return (
              <button
                key={family.id}
                type="button"
                onClick={() => {
                  if (targetPreset) dispatch(setTheme(targetPreset))
                }}
                title={family.label}
                aria-label={`Select ${family.label} theme`}
                aria-pressed={isSelected}
                className="flex-1 flex flex-col items-center gap-1 py-1.5 rounded-md hover:bg-muted transition-colors min-h-11"
              >
                <span
                  className={cn(
                    'h-6 w-6 rounded-full transition-transform hover:scale-110 block',
                    isSelected &&
                      'ring-2 ring-white ring-offset-2 ring-offset-background',
                  )}
                  style={{
                    backgroundColor: `oklch(${SWATCH_LIGHTNESS} ${family.chroma} ${family.hue})`,
                  }}
                />
                <span className="text-[10px] text-muted-foreground leading-none">
                  {family.label}
                </span>
              </button>
            )
          })}
        </div>

        {/* Screen-reader-only announcement of the active preset. The swatch
         * buttons already carry `aria-pressed`, but an explicit label in the
         * menu footer gives AT users a named summary without hunting for
         * which swatch is pressed. */}
        <span className="sr-only">
          Current theme: {THEME_PRESETS[preset].label}
        </span>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
