import laststanceReactNextPlugin from '@laststance/react-next-eslint-plugin'
import tsPrefixer from 'eslint-config-ts-prefixer'
import reactYouMightNotNeedAnEffect from 'eslint-plugin-react-you-might-not-need-an-effect'
import { defineConfig } from 'eslint/config'

export default defineConfig([
  ...tsPrefixer,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      '*.config.js',
      '*.config.ts',
      '*.config.mjs',
      '.pnpmfile.cjs',
      'scripts/**',
      'website/**',
    ],
  },
  // React "You Might Not Need an Effect" rules (explicit instead of configs.recommended)
  {
    plugins: {
      'react-you-might-not-need-an-effect': reactYouMightNotNeedAnEffect,
    },
    rules: {
      'react-you-might-not-need-an-effect/no-empty-effect': 'error',
      'react-you-might-not-need-an-effect/no-adjust-state-on-prop-change':
        'error',
      'react-you-might-not-need-an-effect/no-reset-all-state-on-prop-change':
        'error',
      'react-you-might-not-need-an-effect/no-event-handler': 'error',
      'react-you-might-not-need-an-effect/no-pass-live-state-to-parent':
        'error',
      'react-you-might-not-need-an-effect/no-pass-data-to-parent': 'error',
      'react-you-might-not-need-an-effect/no-initialize-state': 'error',
      'react-you-might-not-need-an-effect/no-chain-state-updates': 'error',
      'react-you-might-not-need-an-effect/no-derived-state': 'error',
    },
  },
  {
    plugins: {
      '@laststance/react-next': laststanceReactNextPlugin,
    },
    rules: {
      '@laststance/react-next/no-forward-ref': 'error',
      '@laststance/react-next/no-context-provider': 'error',
      '@laststance/react-next/no-missing-key': 'error',
      '@laststance/react-next/no-duplicate-key': 'error',
      '@laststance/react-next/no-jsx-without-return': 'error',
      '@laststance/react-next/all-memo': 'error',
      '@laststance/react-next/no-use-reducer': 'error',
      '@laststance/react-next/no-set-state-prop-drilling': [
        'error',
        { depth: 1 },
      ],
      '@laststance/react-next/no-deopt-use-callback': 'error',
      '@laststance/react-next/prefer-stable-context-value': 'error',
    },
  },
])
