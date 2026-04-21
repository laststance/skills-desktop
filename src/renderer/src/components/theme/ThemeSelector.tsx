import { Moon, Palette, Sun } from 'lucide-react'
import React, { type ReactElement } from 'react'

import type { ThemePresetName } from '../../../../shared/constants'
import { THEME_PRESETS } from '../../../../shared/constants'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { setTheme, toggleMode } from '../../redux/slices/themeSlice'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

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
 * Group neutral presets by family (Neutral, Zinc, Slate, Stone, Mauve) so
 * each row in the dropdown renders a Dark/Light pair under a family label.
 * Keeps individual buttons short ("Dark" / "Light") so the dropdown layout
 * stays compact even when test environments don't apply Tailwind utilities,
 * and gives users a clearer visual scan than 10 monochrome buttons in a grid.
 *
 * Family id is derived from the preset name's prefix (`zinc-dark` → `zinc`).
 * The label is taken from whichever variant exists first; for the canonical
 * "Neutral" family the human label drops the "Dark"/"Light" suffix.
 *
 * @example
 * NEUTRAL_FAMILIES === [
 *   { id: 'neutral', label: 'Neutral', dark: 'neutral-dark', light: 'neutral-light' },
 *   { id: 'zinc',    label: 'Zinc',    dark: 'zinc-dark',    light: 'zinc-light' },
 *   ...
 * ]
 */
interface NeutralFamily {
  id: string
  label: string
  dark: ThemePresetName | null
  light: ThemePresetName | null
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
    }
    if (config.mode === 'dark') existing.dark = name
    else existing.light = name
    families.set(familyId, existing)
  }
  return Array.from(families.values())
})()

/**
 * Theme selector dropdown. Renders the 27 preset entries (17 hue-based
 * color themes + 5 neutral families × 2 modes = 10 neutral entries) plus
 * a dark/light mode toggle.
 * All preset data flows from `THEME_PRESETS`; this component only maps
 * state → UI and fires a single `setTheme(presetName)` action per click.
 *
 * Layout:
 *  - Color themes: 6-column swatch grid (3 rows for 17 hues) — color
 *    presets are mode-agnostic, so a swatch click keeps the user's current
 *    light/dark choice.
 *  - Neutral & Tinted: one row per family (Neutral, Zinc, Slate, Stone,
 *    Mauve), with a fixed-width family label followed by Dark/Light
 *    buttons. Short button labels keep layout stable even when Tailwind
 *    utilities aren't compiled (e.g. inside the vitest browser project,
 *    which doesn't load `@tailwindcss/vite`).
 *
 * Wrapped in `React.memo` to match the project-wide memoization convention
 * (enforced by `@laststance/react-next/all-memo`). The component takes no
 * props, so the referential stability is trivial — memo is for consistency
 * with every other component in the tree.
 */
export const ThemeSelector = React.memo(function ThemeSelector(): ReactElement {
  const dispatch = useAppDispatch()
  const { mode, preset } = useAppSelector((state) => state.theme)

  const handleToggleMode = (): void => {
    dispatch(toggleMode())
  }

  const handleSelectPreset = (name: ThemePresetName): void => {
    dispatch(setTheme(name))
  }

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
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Mode toggle — works for every preset. Color presets flip
         * dark/light independently; neutral presets swap preset keys
         * (neutral-dark ↔ neutral-light) via toggleMode. */}
        <DropdownMenuItem onClick={handleToggleMode}>
          {mode === 'dark' ? (
            <>
              <Sun className="mr-2 h-4 w-4" />
              Switch to Light
            </>
          ) : (
            <>
              <Moon className="mr-2 h-4 w-4" />
              Switch to Dark
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        {/* Color themes — chroma > 0, hue varies */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Color Themes
        </DropdownMenuLabel>
        <div className="grid grid-cols-6 gap-0.5 p-1">
          {COLOR_PRESET_NAMES.map((name) => {
            const config = THEME_PRESETS[name]
            const isSelected = preset === name
            return (
              <button
                key={name}
                type="button"
                onClick={() => handleSelectPreset(name)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center"
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
                    backgroundColor: `oklch(0.65 ${config.chroma} ${config.hue})`,
                  }}
                />
              </button>
            )
          })}
        </div>

        <DropdownMenuSeparator />

        {/* Neutral & tinted-neutral themes — chroma === 0 collapses the OKLCH
         * ramp to pure grayscale; chroma === TINTED_NEUTRAL_CHROMA produces
         * shadcn-baseColor-style subtle tints (zinc / slate / stone / mauve).
         * Same formula as color presets, so there is no parallel HSL block
         * to maintain. Each row is a (family label, Dark, Light) triplet so
         * the family name lives in a single header column instead of being
         * repeated on both buttons. The short "Dark"/"Light" button labels
         * keep the dropdown layout compact and predictable even when the
         * test environment doesn't apply Tailwind utilities (the
         * @tailwindcss/vite plugin is loaded only for the real renderer,
         * not for the vitest browser project). */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Neutral &amp; Tinted (shadcn)
        </DropdownMenuLabel>
        <div className="flex flex-col gap-0.5 p-1">
          {NEUTRAL_FAMILIES.map((family) => (
            <div
              key={family.id}
              className="flex items-center gap-1 px-1 py-0.5"
            >
              <span className="text-xs text-muted-foreground w-14 shrink-0 truncate">
                {family.label}
              </span>
              {(['dark', 'light'] as const).map((variant) => {
                const presetName =
                  variant === 'dark' ? family.dark : family.light
                if (!presetName) return null
                const config = THEME_PRESETS[presetName]
                const isSelected = preset === presetName
                const Icon = variant === 'dark' ? Moon : Sun
                return (
                  <button
                    key={presetName}
                    type="button"
                    onClick={() => handleSelectPreset(presetName)}
                    aria-label={`Select ${config.label} theme`}
                    aria-pressed={isSelected}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs transition-colors',
                      'hover:bg-muted',
                      isSelected && 'bg-muted ring-1 ring-primary',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {variant === 'dark' ? 'Dark' : 'Light'}
                  </button>
                )
              })}
            </div>
          ))}
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
