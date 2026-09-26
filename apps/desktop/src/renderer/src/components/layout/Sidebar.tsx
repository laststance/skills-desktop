import React from 'react'

import { AgentDeleteDialog } from '@/renderer/src/components/sidebar/AgentDeleteDialog'
import { AgentsSection } from '@/renderer/src/components/sidebar/AgentsSection'
import { BookmarksSection } from '@/renderer/src/components/sidebar/BookmarksSection'
import { SidebarFooter } from '@/renderer/src/components/sidebar/SidebarFooter'
import { SidebarHeader } from '@/renderer/src/components/sidebar/SidebarHeader'
import { SourceCard } from '@/renderer/src/components/sidebar/SourceCard'
import { ScrollArea } from '@/renderer/src/components/ui/scroll-area'
import { Separator } from '@/renderer/src/components/ui/separator'
import { useAppSelector } from '@/renderer/src/redux/hooks'
import { selectBookmarkItems } from '@/renderer/src/redux/slices/bookmarkSlice'

/**
 * Left sidebar component (272px / w-68)
 * Contains app header, source card, and agents list
 */
export const Sidebar = function Sidebar(): React.ReactElement {
  const bookmarks = useAppSelector(selectBookmarkItems)

  return (
    <aside
      aria-label="Agent sidebar"
      className="w-68 shrink-0 border-r border-border bg-card flex flex-col"
    >
      <SidebarHeader />
      <Separator />
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <SourceCard />
          <Separator />
          <AgentsSection />
          {bookmarks.length > 0 && (
            <>
              <Separator />
              <BookmarksSection />
            </>
          )}
        </div>
      </ScrollArea>
      <SidebarFooter />
      <AgentDeleteDialog />
    </aside>
  )
}
