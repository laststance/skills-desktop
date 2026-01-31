import { cn } from '../../lib/utils'

type RankingFilter = 'all-time' | 'trending' | 'hot'

interface RankingTabsProps {
  value: RankingFilter
  onChange: (value: RankingFilter) => void
}

const tabs: { id: RankingFilter; label: string }[] = [
  { id: 'all-time', label: 'All Time' },
  { id: 'trending', label: 'Trending' },
  { id: 'hot', label: 'Hot' },
]

/**
 * Ranking filter tabs for marketplace skills
 * @param value - Currently selected ranking filter
 * @param onChange - Callback when filter changes
 */
export function RankingTabs({
  value,
  onChange,
}: RankingTabsProps): React.ReactElement {
  return (
    <div className="flex gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'px-4 py-2 rounded-md text-[13px] font-medium transition-colors',
            value === tab.id
              ? 'bg-[#1E293B] text-[#22D3EE]'
              : 'text-[#94A3B8] hover:text-[#CBD5E1] hover:bg-[#1E293B]/50',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export type { RankingFilter }
