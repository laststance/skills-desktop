import {
  Info,
  Keyboard,
  Palette,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react'
import React, { useState } from 'react'
import { match } from 'ts-pattern'

import { ScrollArea } from '../src/components/ui/scroll-area'
import { useSettingsSync } from '../src/hooks/useSettingsSync'
import { cn } from '../src/lib/utils'

import { About } from './sections/About'
import { Appearance } from './sections/Appearance'
import { AutoUpdates } from './sections/AutoUpdates'
import { General } from './sections/General'
import { Keybindings } from './sections/Keybindings'

type Section =
  | 'general'
  | 'appearance'
  | 'autoUpdates'
  | 'keybindings'
  | 'about'

interface NavItem {
  id: Section
  label: string
  icon: React.ComponentType<{ className?: string }>
}

/**
 * Static nav definition. Keep order = visual order so the array is also the
 * tab order — no separate ordering layer to maintain. Lucide icons match the
 * sidebar's existing iconography (single-stroke, 16×16 default).
 */
const NAV_ITEMS: readonly NavItem[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'autoUpdates', label: 'Auto Updates', icon: RefreshCw },
  { id: 'keybindings', label: 'Keybindings', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info },
] as const

/**
 * Top-level Settings window component.
 *
 * Layout: 200px left nav rail + scrollable right pane (Inkdrop-style).
 * The active-section state is local — Settings is a single window that
 * doesn't deep-link to specific sections (yet), so persisting selection
 * across opens isn't worth the IPC round-trip.
 *
 * `useSettingsSync()` runs once on mount: pulls a snapshot via
 * `settings:get`, then subscribes to `settings:changed` so a save in
 * the main window propagates here without polling. Same hook the main
 * window uses — single source of truth for sync logic.
 */
export const SettingsApp = React.memo(
  function SettingsApp(): React.ReactElement {
    useSettingsSync()

    const [activeSection, setActiveSection] = useState<Section>('general')

    return (
      <div className="flex h-screen bg-background text-foreground">
        <nav
          aria-label="Settings sections"
          className="w-50 shrink-0 border-r border-border bg-sidebar/30 py-4"
        >
          <ul className="flex flex-col gap-0.5 px-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const isActive = activeSection === item.id
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => setActiveSection(item.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
        <ScrollArea className="flex-1">
          <div className="px-8 py-6">
            {match(activeSection)
              .with('general', () => <General />)
              .with('appearance', () => <Appearance />)
              .with('autoUpdates', () => <AutoUpdates />)
              .with('keybindings', () => <Keybindings />)
              .with('about', () => <About />)
              .exhaustive()}
          </div>
        </ScrollArea>
      </div>
    )
  },
)
