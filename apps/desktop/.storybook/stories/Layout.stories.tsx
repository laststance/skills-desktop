import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { DetailPanel } from '@/renderer/src/components/layout/DetailPanel'
import { MainContent } from '@/renderer/src/components/layout/MainContent'
import { Sidebar } from '@/renderer/src/components/layout/Sidebar'

import { storyMarketplaceSkills, storySkills } from '../fixtures'
import { StoryCard, StoryGrid } from '../storybook-utils'

const meta = {
  title: 'Layout/Panels',
  parameters: {
    skillsDesktop: {
      width: 1240,
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const InstalledPanels: Story = {
  render: () => (
    <StoryGrid columns={2}>
      <StoryCard
        label="MainContent / Installed"
        className="h-[720px] overflow-hidden"
      >
        <MainContent />
      </StoryCard>
      <StoryCard
        label="DetailPanel / selected skill"
        className="h-[720px] overflow-hidden"
      >
        <DetailPanel />
      </StoryCard>
      <StoryCard label="Sidebar" className="h-[720px] overflow-hidden">
        <Sidebar />
      </StoryCard>
    </StoryGrid>
  ),
  parameters: {
    skillsDesktop: {
      state: {
        skills: {
          selectedSkill: storySkills[0],
        },
      },
    },
  },
}

export const MarketplacePanels: Story = {
  render: () => (
    <StoryGrid columns={2}>
      <StoryCard
        label="MainContent / Marketplace"
        className="h-[720px] overflow-hidden"
      >
        <MainContent />
      </StoryCard>
      <StoryCard
        label="DetailPanel / Marketplace preview"
        className="h-[720px] overflow-hidden"
      >
        <DetailPanel />
      </StoryCard>
    </StoryGrid>
  ),
  parameters: {
    skillsDesktop: {
      state: {
        ui: {
          activeTab: 'marketplace',
        },
        marketplace: {
          previewSkill: storyMarketplaceSkills[0],
        },
      },
    },
  },
}
