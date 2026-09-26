import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { Button } from '@/renderer/src/components/ui/button'
import { SettingsApp } from '@/renderer/settings/SettingsApp'
import { About } from '@/renderer/settings/sections/About'
import { Agents } from '@/renderer/settings/sections/Agents'
import { Appearance } from '@/renderer/settings/sections/Appearance'
import { General } from '@/renderer/settings/sections/General'
import { Keybindings } from '@/renderer/settings/sections/Keybindings'
import {
  SectionFrame,
  SectionRow,
} from '@/renderer/settings/sections/SectionFrame'

import { StoryCard, StoryGrid } from '../storybook-utils'

const meta = {
  title: 'Settings/Components',
  parameters: {
    skillsDesktop: {
      width: 1180,
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const SettingsWindow: Story = {
  render: () => (
    <StoryCard label="SettingsApp" className="h-[720px] overflow-hidden">
      <SettingsApp />
    </StoryCard>
  ),
}

export const SectionPanes: Story = {
  render: () => (
    <StoryGrid columns={2}>
      <StoryCard label="General">
        <General />
      </StoryCard>
      <StoryCard label="Appearance">
        <Appearance />
      </StoryCard>
      <StoryCard label="Agents">
        <Agents />
      </StoryCard>
      <StoryCard label="Keybindings">
        <Keybindings />
      </StoryCard>
      <StoryCard label="About">
        <About />
      </StoryCard>
    </StoryGrid>
  ),
}

export const SectionFrameParts: Story = {
  render: () => (
    <StoryCard label="SectionFrame / SectionRow">
      <SectionFrame
        title="Storybook Section"
        description="A compact settings section using the shared settings chrome."
      >
        <SectionRow
          label="Preview control"
          description="A trailing control sits flush-right against its row label."
        >
          <Button size="sm">Preview action</Button>
        </SectionRow>
      </SectionFrame>
    </StoryCard>
  ),
}
