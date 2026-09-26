import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { ErrorBoundary } from '@/renderer/src/components/ErrorBoundary'
import { SkipToMainContentLink } from '@/renderer/src/components/SkipToMainContentLink'
import { UpdateToast } from '@/renderer/src/components/UpdateToast'
import { semanticVersion } from '@/shared/types'

import { StoryCard, StoryGrid } from '../storybook-utils'

const meta = {
  title: 'Core/Renderer',
  parameters: {
    skillsDesktop: {
      width: 920,
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const ThrowingPreview = function ThrowingPreview(): React.ReactElement {
  throw new Error('Storybook forced render failure')
}

export const ErrorBoundaryFallback: Story = {
  render: () => (
    <div className="h-96 overflow-hidden rounded-lg border border-border">
      <ErrorBoundary>
        <ThrowingPreview />
      </ErrorBoundary>
    </div>
  ),
}

export const SkipLink: Story = {
  render: () => (
    <StoryCard label="SkipToMainContentLink">
      <SkipToMainContentLink />
      <main
        id="main-content"
        tabIndex={-1}
        className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
      >
        Press Tab in the preview to reveal the skip link.
      </main>
    </StoryCard>
  ),
}

export const UpdateToasts: Story = {
  render: () => (
    <StoryGrid columns={1}>
      <StoryCard
        label="Available update"
        className="relative min-h-52 overflow-hidden"
      >
        <UpdateToast />
      </StoryCard>
    </StoryGrid>
  ),

  parameters: {
    skillsDesktop: {
      state: {
        update: {
          status: 'available',
          version: semanticVersion('0.17.0'),
          releaseNotes: 'Storybook coverage.',
          dismissed: false,
        },
      },
    },
  },
}
