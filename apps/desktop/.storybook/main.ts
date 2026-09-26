import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineMain } from '@storybook/react-vite/node'
import { mergeConfig } from 'vite'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

/**
 * Storybook's Vite entry for the Electron renderer.
 *
 * Why this exists:
 * - Storybook runs outside electron-vite, so it must recreate the renderer's
 *   `@` alias, Tailwind v4 plugin, React de-dupe, and Vite `define` constants.
 * - Stories live under `.storybook/stories` so the production renderer tree
 *   stays free of showcase-only modules.
 *
 * @returns Storybook 10 configuration consumed by `storybook dev/build`.
 * @example
 * pnpm storybook
 * pnpm storybook:build
 */
export default defineMain({
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  stories: ['../.storybook/stories/**/*.stories.@(ts|tsx|mdx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  managerHead: (head) => `
    ${head}
    <style>
      :root {
        color-scheme: dark;
      }

      /* Keep the manager focused on the component catalog, not first-run Storybook chrome. */
      a[href$="/settings/whats-new"],
      body:has(button[aria-label*="onboarding"]) [data-testid="notifications"],
      div[class]:has(> div > ul button[aria-label*="onboarding guide"]) {
        display: none !important;
      }

      body {
        background: #070b10;
      }
    </style>
  `,
  async viteFinal(config) {
    return mergeConfig(config, {
      define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
        __E2E_BUILD__: JSON.stringify(false),
      },
      plugins: [
        tailwindcss(),
        // Storybook's react-vite framework already registers @vitejs/plugin-react;
        // only the React Compiler babel preset is added here.
        babel({ presets: [reactCompilerPreset()] }),
      ],
      resolve: {
        alias: {
          '@': resolve(import.meta.dirname, '../src'),
        },
        // Keep every renderer package on the same React singleton. This mirrors
        // vitest.config.ts and avoids Radix / react-redux hook dispatcher splits.
        dedupe: ['react', 'react-dom'],
      },
      optimizeDeps: {
        include: [
          'react',
          'react-dom',
          'react-dom/client',
          'react/jsx-runtime',
          'react-redux',
          '@reduxjs/toolkit',
          '@radix-ui/react-checkbox',
          '@radix-ui/react-dialog',
          '@radix-ui/react-dropdown-menu',
          '@radix-ui/react-scroll-area',
          '@radix-ui/react-tabs',
          '@radix-ui/react-toggle-group',
          '@radix-ui/react-tooltip',
        ],
      },
    })
  },
})
