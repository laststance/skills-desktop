import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { AgentDeleteDialog } from '@/renderer/src/components/sidebar/AgentDeleteDialog'
import { AgentItem } from '@/renderer/src/components/sidebar/AgentItem'
import { AgentsSection } from '@/renderer/src/components/sidebar/AgentsSection'
import { BookmarkDetailModal } from '@/renderer/src/components/sidebar/BookmarkDetailModal'
import { BookmarkItem } from '@/renderer/src/components/sidebar/BookmarkItem'
import { BookmarksSection } from '@/renderer/src/components/sidebar/BookmarksSection'
import { CleanupAgentDialog } from '@/renderer/src/components/sidebar/CleanupAgentDialog'
import { SidebarFooter } from '@/renderer/src/components/sidebar/SidebarFooter'
import { SidebarHeader } from '@/renderer/src/components/sidebar/SidebarHeader'
import { SourceCard } from '@/renderer/src/components/sidebar/SourceCard'
import { SyncConfirmDialog } from '@/renderer/src/components/sidebar/SyncConfirmDialog'
import { SyncConflictDialog } from '@/renderer/src/components/sidebar/SyncConflictDialog'
import { SyncResultDialog } from '@/renderer/src/components/sidebar/SyncResultDialog'
import { Sidebar } from '@/renderer/src/components/layout/Sidebar'

import {
  storyAgents,
  storyBookmarks,
  storySyncPreview,
  storySyncResult,
} from '../fixtures'
import { StoryCard, StoryGrid } from '../storybook-utils'

const meta = {
  title: 'Sidebar/Components',
  parameters: {
    skillsDesktop: {
      width: 1180,
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const bookmarkForDetail = {
  ...storyBookmarks[0]!,
  isInstalled: true,
}

export const SidebarShellAndSections: Story = {
  render: () => (
    <StoryGrid columns={3}>
      <StoryCard label="Sidebar" className="h-[720px] overflow-hidden">
        <Sidebar />
      </StoryCard>
      <StoryCard label="SourceCard">
        <SourceCard />
      </StoryCard>
      <StoryCard label="AgentsSection">
        <AgentsSection />
      </StoryCard>
      <StoryCard label="BookmarksSection">
        <BookmarksSection />
      </StoryCard>
      <StoryCard label="SidebarHeader + SidebarFooter">
        <div className="w-68 rounded-lg border border-border bg-card">
          <SidebarHeader />
          <SidebarFooter />
        </div>
      </StoryCard>
    </StoryGrid>
  ),
}

export const RowComponents: Story = {
  render: () => (
    <StoryGrid columns={2}>
      <StoryCard label="AgentItem / installed">
        <AgentItem agent={storyAgents[0]!} />
      </StoryCard>
      <StoryCard label="AgentItem / missing">
        <AgentItem agent={storyAgents[3]!} />
      </StoryCard>
      <StoryCard label="BookmarkItem / installed">
        <BookmarkItem bookmark={bookmarkForDetail} />
      </StoryCard>
      <StoryCard label="BookmarkItem / installable">
        <BookmarkItem bookmark={{ ...bookmarkForDetail, isInstalled: false }} />
      </StoryCard>
    </StoryGrid>
  ),
}

export const BookmarkDetailOpen: Story = {
  render: () => <BookmarkDetailModal />,
  parameters: {
    skillsDesktop: {
      state: {
        ui: {
          selectedBookmarkForDetail: bookmarkForDetail,
        },
      },
    },
  },
}

export const AgentDeleteOpen: Story = {
  render: () => <AgentDeleteDialog />,
  parameters: {
    skillsDesktop: {
      state: {
        agents: {
          agentToDelete: storyAgents[1],
        },
      },
    },
  },
}

export const SyncConfirmOpen: Story = {
  render: () => <SyncConfirmDialog />,
  parameters: {
    skillsDesktop: {
      state: {
        ui: {
          syncPreview: {
            ...storySyncPreview,
            conflicts: [],
          },
        },
      },
    },
  },
}

export const SyncConflictOpen: Story = {
  render: () => <SyncConflictDialog />,
  parameters: {
    skillsDesktop: {
      state: {
        ui: {
          syncPreview: storySyncPreview,
        },
      },
    },
  },
}

export const CleanupAgentOpen: Story = {
  render: () => <CleanupAgentDialog />,
  parameters: {
    skillsDesktop: {
      state: {
        ui: {
          cleanupAgentTarget: 'cursor',
          syncPreview: {
            ...storySyncPreview,
            forAgent: 'cursor',
          },
        },
      },
    },
  },
}

export const SyncResultOpen: Story = {
  render: () => <SyncResultDialog />,
  parameters: {
    skillsDesktop: {
      state: {
        ui: {
          syncResult: storySyncResult,
        },
      },
    },
  },
}
