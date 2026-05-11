import { ExternalLink, Settings } from 'lucide-react'
import React from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/renderer/src/components/ui/tooltip'

const SKILLS_REGISTRY_URL = 'https://skills.sh/'

/**
 * Sidebar footer hosting two affordances:
 *  - the existing skills.sh marketplace link (opens in default browser)
 *  - a gear icon that opens the Settings window via IPC, mirroring the
 *    App menu's `Settings… ⌘,` item (Inkdrop-style dual-route open).
 *
 * Layout: skills.sh link is centered; gear is anchored to the right so
 * the link still reads as the primary footer affordance and the gear
 * stays out of the way until the user reaches for it.
 */
export const SidebarFooter = React.memo(
  function SidebarFooter(): React.ReactElement {
    const handleSkillsLinkClick = (): void => {
      window.electron.shell.openExternal(SKILLS_REGISTRY_URL)
    }

    const handleSettingsClick = (): void => {
      void window.electron.settings.open()
    }

    return (
      <div className="border-t border-border px-6 py-3 flex items-center">
        <button
          type="button"
          onClick={handleSkillsLinkClick}
          className="flex flex-1 items-center justify-center gap-1.5 text-xs font-medium font-mono text-muted-foreground hover:text-primary transition-colors"
        >
          <span>skills.sh</span>
          <ExternalLink className="h-3 w-3" />
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open settings"
              onClick={handleSettingsClick}
              className="no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Settings (⌘,)</TooltipContent>
        </Tooltip>
      </div>
    )
  },
)
