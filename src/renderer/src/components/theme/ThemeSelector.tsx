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

const COLOR_PRESET_NAMES: ThemePresetName[] = [
  'rose',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
]

const NEUTRAL_PRESET_NAMES: ThemePresetName[] = [
  'neutral-dark',
  'neutral-light',
]

/**
 * Theme selector dropdown. Renders the 14 preset swatches (12 hue-based
 * color themes + 2 shadcn neutral variants) plus a dark/light mode toggle.
 * All preset data flows from `THEME_PRESETS`; this component only maps
 * state → UI and fires a single `setTheme(presetName)` action per click.
 *
 * Wrapped in `React.memo` to match the project-wide memoization convention
 * (enforced by `@laststance/react-next/all-memo`). The component takes no
 * props, so the referential stability is trivial — memo is for consistency
 * with every other component in the tree.
 */
export const ThemeSelector = React.memo(function ThemeSelector(): ReactElement {
  const dispatch = useAppDispatch()
  const { mode, preset, chroma } = useAppSelector((state) => state.theme)

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

        {/* Neutral themes (shadcn defaults) — chroma === 0 collapses the
         * OKLCH ramp to pure grayscale. Same formula as color presets, so
         * there is no parallel HSL block to maintain. */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Neutral (shadcn)
        </DropdownMenuLabel>
        <div className="flex gap-2 p-2">
          {NEUTRAL_PRESET_NAMES.map((name) => {
            const config = THEME_PRESETS[name]
            const isSelected = preset === name
            const neutralMode = 'mode' in config ? config.mode : 'dark'
            const Icon = neutralMode === 'dark' ? Moon : Sun
            return (
              <button
                key={name}
                type="button"
                onClick={() => handleSelectPreset(name)}
                aria-label={`Select ${config.label} theme`}
                aria-pressed={isSelected}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                  'hover:bg-muted',
                  isSelected && 'bg-muted ring-1 ring-primary',
                )}
              >
                <Icon className="h-4 w-4" />
                {neutralMode === 'dark' ? 'Dark' : 'Light'}
              </button>
            )
          })}
        </div>

        {/* Chroma axis is an implementation detail — surfaced here only as
         * an a11y hint for screen readers inspecting the menu. */}
        <span className="sr-only">
          Current chroma: {chroma === 0 ? 'neutral' : 'color'}
        </span>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
