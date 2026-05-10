import type { Preview } from '@storybook/react-vite'

import '../src/renderer/src/styles/globals.css'
import './preview.css'
import {
  installStorybookElectronMock,
  STORYBOOK_DEFAULT_THEME_MODE,
  STORYBOOK_DEFAULT_THEME_PRESET,
  STORYBOOK_THEME_MODE_GLOBAL,
  STORYBOOK_THEME_MODE_ITEMS,
  STORYBOOK_THEME_PRESET_GLOBAL,
  STORYBOOK_THEME_PRESET_ITEMS,
  withSkillsDesktopProviders,
} from './storybook-utils'

installStorybookElectronMock()

/**
 * Global preview configuration.
 *
 * Every story renders inside the real app theme tokens, Redux slices, Radix
 * tooltip provider, and a deterministic Electron preload mock. That makes
 * container components safe to mount without requiring Electron itself.
 *
 * @example
 * parameters: { skillsDesktop: { state: { ui: { activeTab: 'marketplace' } } } }
 */
const preview: Preview = {
  decorators: [withSkillsDesktopProviders],
  globalTypes: {
    [STORYBOOK_THEME_PRESET_GLOBAL]: {
      name: 'Theme',
      description: 'Application theme preset for every story',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [...STORYBOOK_THEME_PRESET_ITEMS],
        dynamicTitle: true,
      },
    },
    [STORYBOOK_THEME_MODE_GLOBAL]: {
      name: 'Mode',
      description: 'Application light/dark mode for every story',
      toolbar: {
        title: 'Mode',
        icon: 'circlehollow',
        items: [...STORYBOOK_THEME_MODE_ITEMS],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    [STORYBOOK_THEME_PRESET_GLOBAL]: STORYBOOK_DEFAULT_THEME_PRESET,
    [STORYBOOK_THEME_MODE_GLOBAL]: STORYBOOK_DEFAULT_THEME_MODE,
  },
  parameters: {
    layout: 'fullscreen',
    backgrounds: {
      disable: true,
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    docs: {
      toc: true,
    },
    options: {
      storySort: {
        order: [
          'App',
          'Layout',
          'Skills',
          'Marketplace',
          'Dashboard',
          'Sidebar',
          'Settings',
          'Primitives',
          'Core',
        ],
      },
    },
  },
}

export default preview
