import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { InstallModal } from '@/renderer/src/components/marketplace/InstallModal'
import { LeaderboardSkeleton } from '@/renderer/src/components/marketplace/LeaderboardSkeleton'
import { MarketplaceDashboard } from '@/renderer/src/components/marketplace/MarketplaceDashboard'
import { MarketplaceDetailPanel } from '@/renderer/src/components/marketplace/MarketplaceDetailPanel'
import { MarketplaceSearch } from '@/renderer/src/components/marketplace/MarketplaceSearch'
import { MarketplaceSkillPreview } from '@/renderer/src/components/marketplace/MarketplaceSkillPreview'
import { RankingTabs } from '@/renderer/src/components/marketplace/RankingTabs'
import { SkillRowMarketplace } from '@/renderer/src/components/marketplace/SkillRowMarketplace'
import { SkillsMarketplace } from '@/renderer/src/components/marketplace/SkillsMarketplace'

import { storyMarketplaceSkills } from '../fixtures'
import { StoryCard, StoryGrid } from '../storybook-utils'

const meta = {
  title: 'Marketplace/Components',
  parameters: {
    skillsDesktop: {
      width: 1180,
      state: {
        ui: {
          activeTab: 'marketplace',
        },
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const SearchTabsAndRows: Story = {
  render: () => (
    <StoryGrid columns={1}>
      <StoryCard label="MarketplaceSearch">
        <MarketplaceSearch />
      </StoryCard>
      <StoryCard label="RankingTabs">
        <RankingTabs value="trending" onChange={() => undefined} />
      </StoryCard>
      <StoryCard label="SkillRowMarketplace">
        <div className="space-y-2">
          {storyMarketplaceSkills.map((skill, index) => (
            <SkillRowMarketplace
              key={skill.name}
              skill={skill}
              isInstalled={index === 0}
            />
          ))}
        </div>
      </StoryCard>
    </StoryGrid>
  ),
}

export const MarketplaceContainers: Story = {
  render: () => (
    <StoryGrid columns={2}>
      <StoryCard
        label="SkillsMarketplace"
        className="h-[620px] overflow-hidden"
      >
        <SkillsMarketplace />
      </StoryCard>
      <StoryCard
        label="MarketplaceDashboard"
        className="h-[620px] overflow-hidden"
      >
        <MarketplaceDashboard />
      </StoryCard>
      <StoryCard
        label="MarketplaceDetailPanel / dashboard"
        className="h-[620px] overflow-hidden"
      >
        <MarketplaceDetailPanel />
      </StoryCard>
      <StoryCard
        label="MarketplaceSkillPreview"
        className="h-[620px] overflow-hidden"
      >
        <MarketplaceSkillPreview skill={storyMarketplaceSkills[0]!} />
      </StoryCard>
    </StoryGrid>
  ),
}

export const LoadingAndInstallStates: Story = {
  render: () => (
    <StoryGrid columns={2}>
      <StoryCard label="LeaderboardSkeleton">
        <LeaderboardSkeleton />
      </StoryCard>
      <StoryCard label="InstallModal">
        <InstallModal />
      </StoryCard>
    </StoryGrid>
  ),
  parameters: {
    skillsDesktop: {
      state: {
        marketplace: {
          selectedSkill: storyMarketplaceSkills[0],
          installProgress: {
            phase: 'installing',
            message: 'Linking skill into selected agents',
            percent: 72,
          },
        },
      },
    },
  },
}
