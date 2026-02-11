import { ExternalLink, X } from 'lucide-react'
import { useState } from 'react'

import { FEATURE_FLAGS } from '../../../../shared/featureFlags'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { selectAgent } from '../../redux/slices/uiSlice'
import { SkillsMarketplace } from '../marketplace'
import { SyncConflictDialog } from '../sidebar/SyncConflictDialog'
import { AddSymlinkModal } from '../skills/AddSymlinkModal'
import { DeleteSkillDialog } from '../skills/DeleteSkillDialog'
import { SearchBox } from '../skills/SearchBox'
import { SkillsList } from '../skills/SkillsList'
import { UnlinkDialog } from '../skills/UnlinkDialog'
import { Button } from '../ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'

const SKILLS_SH_URL = 'https://skills.sh'

/**
 * Main content area (flexible width)
 * Contains tabs for installed skills and marketplace
 */
export function MainContent(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { selectedAgentId } = useAppSelector((state) => state.ui)
  const { items: agents } = useAppSelector((state) => state.agents)
  const [activeTab, setActiveTab] = useState<string>('installed')

  const selectedAgent = agents.find((a) => a.id === selectedAgentId)

  const handleClearFilter = (): void => {
    dispatch(selectAgent(null))
  }

  /**
   * Handle tab change - only for internal tabs.
   * Marketplace external link is handled separately to avoid Radix state issues.
   */
  const handleTabChange = (value: string): void => {
    setActiveTab(value)
  }

  /**
   * Open skills.sh in external browser.
   * Separate from tab state to prevent navigation loop on app refocus.
   */
  const handleOpenMarketplace = (): void => {
    window.electron.shell.openExternal(SKILLS_SH_URL)
  }

  return (
    <main className="h-full flex flex-col overflow-hidden">
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
          <div className="p-4 border-b border-border shrink-0">
            <SearchBox />
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
                className="h-6 px-2"
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
      <SyncConflictDialog />
    </main>
  )
}
