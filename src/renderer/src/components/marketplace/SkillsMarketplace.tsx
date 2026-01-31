import { Package } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useMarketplaceProgress } from '../../hooks/useMarketplaceProgress'
import { useAppSelector } from '../../redux/hooks'
import { ScrollArea } from '../ui/scroll-area'

import { InstallModal } from './InstallModal'
import { MarketplaceSearch } from './MarketplaceSearch'
import { type RankingFilter, RankingTabs } from './RankingTabs'
import { RemoveDialog } from './RemoveDialog'
import { SkillRowMarketplace } from './SkillRowMarketplace'

/**
 * Main marketplace container with ranking tabs, search and results
 */
export function SkillsMarketplace(): React.ReactElement {
  // Subscribe to installation progress events
  useMarketplaceProgress()

  const [rankingFilter, setRankingFilter] = useState<RankingFilter>('all-time')

  const { searchResults, status, searchQuery, error } = useAppSelector(
    (state) => state.marketplace,
  )
  const { items: installedSkills } = useAppSelector((state) => state.skills)

  // Check if a skill is already installed
  const installedSkillNames = useMemo(
    () => new Set(installedSkills.map((s) => s.name)),
    [installedSkills],
  )

  const hasSearched = searchQuery.length > 0
  const isSearching = status === 'searching'

  return (
    <div className="h-full flex flex-col">
      {/* Header with Title and Search */}
      <div className="p-6 pb-4 space-y-4">
        {/* Title */}
        <div>
          <h1 className="text-[28px] font-bold text-white">
            Skills Marketplace
          </h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            Browse, search and install skills from skills.sh
          </p>
        </div>

        {/* Ranking Tabs */}
        <RankingTabs value={rankingFilter} onChange={setRankingFilter} />

        {/* Search */}
        <MarketplaceSearch />
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-6 mb-4 px-4 py-2 bg-destructive/10 border border-destructive/20 rounded-md">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Results area */}
      <ScrollArea className="flex-1 px-6">
        <div className="pb-6">
          {/* Initial state */}
          {!hasSearched && !isSearching && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Package className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium mb-2">Search for Skills</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Try searching for &quot;react&quot;, &quot;vercel&quot;, or
                &quot;nextjs&quot; to discover skills.
              </p>
            </div>
          )}

          {/* Loading state */}
          {isSearching && (
            <div className="flex items-center justify-center py-16">
              <div className="text-muted-foreground">Searching...</div>
            </div>
          )}

          {/* No results */}
          {hasSearched && !isSearching && searchResults.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-muted-foreground">
                No skills found for &quot;{searchQuery}&quot;
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Try a different search term
              </p>
            </div>
          )}

          {/* Results list */}
          {searchResults.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground mb-3">
                Found {searchResults.length} skill
                {searchResults.length !== 1 ? 's' : ''} for &quot;{searchQuery}
                &quot;
              </p>
              {searchResults.map((skill) => (
                <SkillRowMarketplace
                  key={`${skill.repo}@${skill.name}`}
                  skill={skill}
                  isInstalled={installedSkillNames.has(skill.name)}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Modals */}
      <InstallModal />
      <RemoveDialog />
    </div>
  )
}
