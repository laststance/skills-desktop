import React from 'react'

import { AgentDeleteDialog } from '../sidebar/AgentDeleteDialog'
import { AgentsSection } from '../sidebar/AgentsSection'
import { SidebarFooter } from '../sidebar/SidebarFooter'
import { SidebarHeader } from '../sidebar/SidebarHeader'
import { SourceCard } from '../sidebar/SourceCard'
import { ScrollArea } from '../ui/scroll-area'
import { Separator } from '../ui/separator'

/**
 * Left sidebar component (240px width)
 * Contains app header, source card, and agents list
 */
export const Sidebar = React.memo(function Sidebar(): React.ReactElement {
  return (
    <aside
      aria-label="Agent sidebar"
      className="w-[240px] border-r border-border bg-card flex flex-col"
    >
      <SidebarHeader />
      <Separator />
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <SourceCard />
          <Separator />
          <AgentsSection />
        </div>
      </ScrollArea>
      <SidebarFooter />
      <AgentDeleteDialog />
    </aside>
  )
})
