import type { Meta, StoryObj } from '@storybook/react-vite'

import App from '@/renderer/src/App'
import { semanticVersion } from '@/shared/types'

const meta = {
  title: 'App/Shell',
  component: App,
  parameters: {
    skillsDesktop: {
      state: {
        update: {
          status: 'available',
          version: semanticVersion('0.17.0'),
          releaseNotes: 'Storybook component coverage and UI polish.',
          dismissed: false,
        },
      },
    },
  },
} satisfies Meta<typeof App>

export default meta
type Story = StoryObj<typeof meta>

export const MainWindow: Story = {}

export const MarketplaceMode: Story = {
  parameters: {
    skillsDesktop: {
      state: {
        ui: {
          activeTab: 'marketplace',
        },
      },
    },
  },
}
