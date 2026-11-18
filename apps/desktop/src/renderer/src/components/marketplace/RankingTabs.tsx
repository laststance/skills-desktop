import React from 'react'

import { cn } from '@/renderer/src/lib/utils'
import type { RankingFilter } from '@/shared/types'

interface RankingTabsProps {
  value: RankingFilter
  onChange: (value: RankingFilter) => void
  /** When true, tabs are visually dimmed and non-interactive (during search) */
  disabled?: boolean
}

const tabs: { id: RankingFilter; label: string }[] = [
  { id: 'all-time', label: 'All Time' },
  { id: 'trending', label: 'Trending' },
  { id: 'hot', label: 'Hot' },
]

/**
 * Ranking filter tabs for marketplace leaderboard.
 * Follows WAI-ARIA Tabs pattern: role=tablist, role=tab, aria-selected, arrow-key navigation.
 * @param value - Currently selected ranking filter
 * @param onChange - Callback when filter changes
 * @param disabled - Dims and disables tabs (during active search)
 */
export const RankingTabs = function RankingTabs({
  value,
  onChange,
  disabled = false,
}: RankingTabsProps): React.ReactElement {
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (disabled || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight'))
      return

    event.preventDefault()
    const currentIndex = tabs.findIndex((tab) => tab.id === value)
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length
    onChange(tabs[nextIndex].id)
    // Enter and Space activate whichever button has DOM focus.
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [nextIndex].focus()
  }

  return (
    // react-doctor-disable-next-line react-doctor/interactive-supports-focus -- roving-tabindex tablist: the child [role=tab] buttons own focus (tabIndex 0/-1); the container must not be a tab stop. onKeyDown handles arrows via event bubbling from the focused tab.
    <div
      role="tablist"
      aria-label="Leaderboard ranking"
      className={cn('flex gap-2', disabled && 'opacity-50 pointer-events-none')}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          disabled={disabled}
          className={cn(
            'px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors min-h-8 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            value === tab.id
              ? 'bg-card text-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-card/50',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
