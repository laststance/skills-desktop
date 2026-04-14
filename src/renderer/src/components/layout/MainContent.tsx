import {
  ArrowDownAZ,
  ArrowUpAZ,
  ChevronDown,
  ExternalLink,
  X,
} from 'lucide-react'
import React from 'react'

import { FEATURE_FLAGS } from '../../../../shared/featureFlags'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { setPreviewSkill } from '../../redux/slices/marketplaceSlice'
import type { ActiveTab, SkillTypeFilter } from '../../redux/slices/uiSlice'
import {
  selectAgent,
  setActiveTab,
  setSkillTypeFilter,
  toggleSortOrder,
} from '../../redux/slices/uiSlice'
import { SkillsMarketplace } from '../marketplace'
import { SyncConfirmDialog } from '../sidebar/SyncConfirmDialog'
import { SyncConflictDialog } from '../sidebar/SyncConflictDialog'
import { AddSymlinkModal } from '../skills/AddSymlinkModal'
import { CopyToAgentsModal } from '../skills/CopyToAgentsModal'
import { DeleteSkillDialog } from '../skills/DeleteSkillDialog'
import { SearchBox } from '../skills/SearchBox'
import { SkillsList } from '../skills/SkillsList'
import { UnlinkDialog } from '../skills/UnlinkDialog'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'

const SKILL_TYPE_FILTER_OPTIONS: {
  value: SkillTypeFilter
  label: string
  /** Colored dot class to match skill type visual indicators */
  dotClass?: string
}[] = [
  { value: 'all', label: 'All' },
  { value: 'symlinked', label: 'Symlinked', dotClass: 'bg-cyan-400' },
  { value: 'local', label: 'Local', dotClass: 'bg-emerald-400' },
]

const SKILLS_SH_URL = 'https://skills.sh'

/**
 * Main content area (flexible width)
 * Contains tabs for installed skills and marketplace
 */
export const MainContent = React.memo(
  function MainContent(): React.ReactElement {
    const dispatch = useAppDispatch()
    const selectedAgentId = useAppSelector((state) => state.ui.selectedAgentId)
    const sortOrder = useAppSelector((state) => state.ui.sortOrder)
    const skillTypeFilter = useAppSelector((state) => state.ui.skillTypeFilter)
    const { items: agents } = useAppSelector((state) => state.agents)
    const activeTab = useAppSelector((state) => state.ui.activeTab)

    const selectedAgent = agents.find((a) => a.id === selectedAgentId)

    const handleClearFilter = (): void => {
      dispatch(selectAgent(null))
    }

    /**
     * Handle tab change - only for internal tabs.
     * Marketplace external link is handled separately to avoid Radix state issues.
     */
    const handleTabChange = (value: string): void => {
      dispatch(setActiveTab(value as ActiveTab))
      dispatch(setPreviewSkill(null))
    }

    /**
     * Open skills.sh in external browser.
     * Separate from tab state to prevent navigation loop on app refocus.
     */
    const handleOpenMarketplace = (): void => {
      window.electron.shell.openExternal(SKILLS_SH_URL)
    }

    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="h-full flex flex-col overflow-hidden outline-none"
      >
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="h-full flex flex-col"
        >
          <div className="p-4 border-b border-border">
            <TabsList className="w-full">
              <TabsTrigger value="installed" className="flex-1">
                Installed
              </TabsTrigger>
              {FEATURE_FLAGS.ENABLE_MARKETPLACE_UI ? (
                <TabsTrigger value="marketplace" className="flex-1">
                  Marketplace
                </TabsTrigger>
              ) : (
                <button
                  type="button"
                  onClick={handleOpenMarketplace}
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 flex-1 gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  Marketplace
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </TabsList>
          </div>

          <TabsContent
            value="installed"
            className="flex-1 m-0 data-[state=active]:flex data-[state=active]:flex-col min-h-0 overflow-hidden"
          >
            <div className="p-4 border-b border-border shrink-0 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <SearchBox />
              </div>

              {/* Sort toggle: A→Z ⟷ Z→A */}
              <Button
                variant="ghost"
                size="icon"
                aria-label={
                  sortOrder === 'asc'
                    ? 'Sorted A to Z, click to reverse'
                    : 'Sorted Z to A, click to reverse'
                }
                onClick={() => dispatch(toggleSortOrder())}
                className="shrink-0 text-muted-foreground hover:text-foreground min-h-[44px] min-w-[44px]"
              >
                {sortOrder === 'asc' ? (
                  <ArrowDownAZ className="h-4 w-4" />
                ) : (
                  <ArrowUpAZ className="h-4 w-4" />
                )}
              </Button>

              {/* Skill type filter — agent view only */}
              {selectedAgentId && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`shrink-0 gap-1.5 min-h-[44px] ${
                        skillTypeFilter !== 'all'
                          ? 'text-primary'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {
                        SKILL_TYPE_FILTER_OPTIONS.find(
                          (o) => o.value === skillTypeFilter,
                        )!.label
                      }
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuRadioGroup
                      value={skillTypeFilter}
                      onValueChange={(v) =>
                        dispatch(setSkillTypeFilter(v as SkillTypeFilter))
                      }
                    >
                      {SKILL_TYPE_FILTER_OPTIONS.map((option) => (
                        <DropdownMenuRadioItem
                          key={option.value}
                          value={option.value}
                          className="gap-2"
                        >
                          {option.dotClass ? (
                            <span
                              className={`h-2 w-2 rounded-full ${option.dotClass}`}
                            />
                          ) : (
                            <span className="h-2 w-2" />
                          )}
                          {option.label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {/* Agent filter indicator */}
            {selectedAgent && (
              <div className="px-4 py-2 border-b border-border bg-primary/5 flex items-center justify-between shrink-0">
                <span className="text-sm">
                  Showing skills for{' '}
                  <strong className="text-primary">{selectedAgent.name}</strong>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilter}
                  className="min-h-[44px] px-3"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear
                </Button>
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-auto p-4">
              <SkillsList />
            </div>
          </TabsContent>

          <TabsContent
            value="marketplace"
            className="flex-1 m-0 data-[state=active]:flex data-[state=active]:flex-col min-h-0 overflow-hidden"
          >
            <SkillsMarketplace />
          </TabsContent>
        </Tabs>

        {/* Dialogs */}
        <UnlinkDialog />
        <DeleteSkillDialog />
        <AddSymlinkModal />
        <CopyToAgentsModal />
        <SyncConfirmDialog />
        <SyncConflictDialog />
      </main>
    )
  },
)
