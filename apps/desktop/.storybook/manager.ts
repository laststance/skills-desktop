import { addons } from 'storybook/manager-api'

import { skillsDesktopTheme } from './theme'

/**
 * Storybook manager shell configuration.
 *
 * The renderer preview uses the app's own Tailwind/OKLCH tokens. This file
 * styles the surrounding Storybook UI so the component workshop feels like a
 * Laststance engineering tool instead of the stock Storybook chrome.
 *
 * @example
 * pnpm storybook // manager opens with Skills Desktop branding
 */
addons.setConfig({
  theme: skillsDesktopTheme,
  panelPosition: 'right',
  sidebar: {
    showRoots: true,
    collapsedRoots: ['Primitives'],
  },
  toolbar: {
    title: { hidden: false },
    zoom: { hidden: false },
    eject: { hidden: true },
    copy: { hidden: true },
    fullscreen: { hidden: false },
  },
})
