import { Flame } from 'lucide-react'
import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { DashboardCanvas } from '@/renderer/src/components/dashboard/DashboardCanvas'
import { DashboardEditToolbar } from '@/renderer/src/components/dashboard/DashboardEditToolbar'
import { DashboardPageTabs } from '@/renderer/src/components/dashboard/DashboardPageTabs'
import type { WidgetInstance } from '@/renderer/src/components/dashboard/types'
import { WidgetPicker } from '@/renderer/src/components/dashboard/WidgetPicker'
import { WidgetShell } from '@/renderer/src/components/dashboard/WidgetShell'
import { ActivityTimelineWidget } from '@/renderer/src/components/dashboard/widgets/ActivityTimelineWidget'
import { AgentHeatmapWidget } from '@/renderer/src/components/dashboard/widgets/AgentHeatmapWidget'
import { BookmarksWidget } from '@/renderer/src/components/dashboard/widgets/BookmarksWidget'
import { CoverageWidget } from '@/renderer/src/components/dashboard/widgets/CoverageWidget'
import { HealthWidget } from '@/renderer/src/components/dashboard/widgets/HealthWidget'
import { LeaderboardSkeleton } from '@/renderer/src/components/dashboard/widgets/LeaderboardSkeleton'
import { LeaderboardWidget } from '@/renderer/src/components/dashboard/widgets/LeaderboardWidget'
import { MarketplaceSkillRow } from '@/renderer/src/components/dashboard/widgets/MarketplaceSkillRow'
import { QuickActionsWidget } from '@/renderer/src/components/dashboard/widgets/QuickActionsWidget'
import { getWidgetDefinition } from '@/renderer/src/components/dashboard/widgets/registry'
import { StatsWidget } from '@/renderer/src/components/dashboard/widgets/StatsWidget'
import { TrendingWidget } from '@/renderer/src/components/dashboard/widgets/TrendingWidget'
import { WelcomeWidget } from '@/renderer/src/components/dashboard/widgets/WelcomeWidget'
import { WhatsNewWidget } from '@/renderer/src/components/dashboard/widgets/WhatsNewWidget'

import { storyMarketplaceSkills } from '../fixtures'
import { StoryCard, StoryGrid } from '../storybook-utils'

const meta = {
  title: 'Dashboard/Components',
  parameters: {
    skillsDesktop: {
      width: 1200,
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const welcomeInstance: WidgetInstance = {
  id: 'storybook-welcome' as never,
  type: 'welcome',
  x: 0,
  y: 0,
  w: 6,
  h: 3,
}

const statsInstance: WidgetInstance = {
  id: 'storybook-stats' as never,
  type: 'stats',
  x: 0,
  y: 0,
  w: 3,
  h: 2,
}

export const CanvasAndControls: Story = {
  render: () => (
    <StoryGrid columns={1}>
      <StoryCard label="DashboardCanvas" className="h-[720px] overflow-hidden">
        <DashboardCanvas />
      </StoryCard>
      <StoryCard label="DashboardPageTabs + DashboardEditToolbar">
        <DashboardPageTabs />
        <DashboardEditToolbar />
      </StoryCard>
      <StoryCard label="WidgetPicker">
        <WidgetPicker open onOpenChange={() => undefined} />
      </StoryCard>
    </StoryGrid>
  ),
  parameters: {
    skillsDesktop: {
      state: {
        dashboard: {
          isEditMode: true,
        },
      },
    },
  },
}

export const WidgetShellFrame: Story = {
  render: () => (
    <StoryCard label="WidgetShell / Stats" className="h-56 overflow-hidden">
      <WidgetShell
        instance={statsInstance}
        definition={getWidgetDefinition('stats')!}
      />
    </StoryCard>
  ),
  parameters: {
    skillsDesktop: {
      state: {
        dashboard: {
          isEditMode: true,
        },
      },
    },
  },
}

export const WidgetBodies: Story = {
  render: () => (
    <StoryGrid columns={3}>
      <StoryCard label="WelcomeWidget" className="h-56 overflow-hidden">
        <WelcomeWidget instance={welcomeInstance} />
      </StoryCard>
      <StoryCard label="StatsWidget" className="h-40 overflow-hidden">
        <StatsWidget />
      </StoryCard>
      <StoryCard label="HealthWidget" className="h-40 overflow-hidden">
        <HealthWidget />
      </StoryCard>
      <StoryCard label="CoverageWidget" className="h-72 overflow-hidden">
        <CoverageWidget />
      </StoryCard>
      <StoryCard label="BookmarksWidget" className="h-72 overflow-hidden">
        <BookmarksWidget />
      </StoryCard>
      <StoryCard label="QuickActionsWidget" className="h-56 overflow-hidden">
        <QuickActionsWidget />
      </StoryCard>
      <StoryCard label="TrendingWidget" className="h-72 overflow-hidden">
        <TrendingWidget />
      </StoryCard>
      <StoryCard label="WhatsNewWidget" className="h-72 overflow-hidden">
        <WhatsNewWidget />
      </StoryCard>
      <StoryCard label="LeaderboardWidget" className="h-72 overflow-hidden">
        <LeaderboardWidget
          filter="trending"
          rowLimit={4}
          emptyIcon={Flame}
          emptyMessage="No skills yet"
          errorMessage="Could not load skills"
        />
      </StoryCard>
      <StoryCard label="AgentHeatmapWidget" className="h-72 overflow-hidden">
        <AgentHeatmapWidget />
      </StoryCard>
      <StoryCard
        label="ActivityTimelineWidget"
        className="h-72 overflow-hidden"
      >
        <ActivityTimelineWidget />
      </StoryCard>
      <StoryCard
        label="Dashboard LeaderboardSkeleton"
        className="h-72 overflow-hidden"
      >
        <LeaderboardSkeleton />
      </StoryCard>
    </StoryGrid>
  ),
}

export const CompactMarketplaceRow: Story = {
  render: () => (
    <StoryCard label="Dashboard MarketplaceSkillRow" className="max-w-md">
      <MarketplaceSkillRow skill={storyMarketplaceSkills[0]!} />
    </StoryCard>
  ),
}
