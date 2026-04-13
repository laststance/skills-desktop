import React from 'react'

import type { RankingFilter } from '../../../../shared/types'
import { cn } from '../../lib/utils'

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
export const RankingTabs = React.memo(function RankingTabs({
  value,
  onChange,
  disabled = false,
}: RankingTabsProps): React.ReactElement {
  /** Arrow key navigation: Left/Right cycle between tabs */
  function handleKeyDown(e: React.KeyboardEvent): void {
    if (disabled) return
    const currentIndex = tabs.findIndex((t) => t.id === value)
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = tabs[(currentIndex + 1) % tabs.length]
      onChange(next.id)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      const prev = tabs[(currentIndex - 1 + tabs.length) % tabs.length]
      onChange(prev.id)
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Leaderboard ranking"
      className={cn('flex gap-2', disabled && 'opacity-50 pointer-events-none')}
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          disabled={disabled}
          className={cn(
            'px-4 py-2 rounded-md text-[13px] font-medium transition-colors min-h-[44px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
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
})

export type { RankingFilter }
