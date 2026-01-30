import { Moon, Palette, Sun } from 'lucide-react'

import { THEME_HUES } from '../../../../shared/constants'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  setColorTheme,
  setNeutralTheme,
  toggleMode,
} from '../../redux/slices/themeSlice'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

/**
 * Theme selector dropdown
 * Allows choosing between 12 OKLCH color themes and 2 neutral (shadcn default) themes
 */
export function ThemeSelector(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { hue, mode, preset, presetType } = useAppSelector(
    (state) => state.theme,
  )

  const handleToggleMode = (): void => {
    dispatch(toggleMode())
  }

  const handleSelectColorTheme = (name: string, themeHue: number): void => {
    dispatch(setColorTheme({ preset: name, hue: themeHue }))
  }

  const handleSelectNeutralTheme = (themeMode: 'dark' | 'light'): void => {
    dispatch(
      setNeutralTheme({ preset: `neutral-${themeMode}`, mode: themeMode }),
    )
  }

  const isNeutralSelected = presetType === 'neutral'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Mode toggle (only for color themes) */}
        {presetType === 'color' && (
          <>
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
          </>
        )}

        {/* Color themes */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Color Themes
        </DropdownMenuLabel>
        <div className="grid grid-cols-6 gap-1 p-2">
          {Object.entries(THEME_HUES).map(([name, themeHue]) => (
            <button
              key={name}
              onClick={() => handleSelectColorTheme(name, themeHue)}
              className={cn(
                'h-6 w-6 rounded-full transition-transform hover:scale-110',
                presetType === 'color' &&
                  hue === themeHue &&
                  'ring-2 ring-white ring-offset-2 ring-offset-background',
              )}
              style={{ backgroundColor: `oklch(0.65 0.2 ${themeHue})` }}
              title={name.charAt(0).toUpperCase() + name.slice(1)}
            />
          ))}
        </div>

        <DropdownMenuSeparator />

        {/* Neutral themes (shadcn defaults) */}
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Neutral (shadcn)
        </DropdownMenuLabel>
        <div className="flex gap-2 p-2">
          <button
            onClick={() => handleSelectNeutralTheme('dark')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
              'hover:bg-muted',
              isNeutralSelected &&
                preset === 'neutral-dark' &&
                'bg-muted ring-1 ring-primary',
            )}
          >
            <Moon className="h-4 w-4" />
            Dark
          </button>
          <button
            onClick={() => handleSelectNeutralTheme('light')}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
              'hover:bg-muted',
              isNeutralSelected &&
                preset === 'neutral-light' &&
                'bg-muted ring-1 ring-primary',
            )}
          >
            <Sun className="h-4 w-4" />
            Light
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
