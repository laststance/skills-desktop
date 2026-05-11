import laststanceReactNextPlugin from '@laststance/react-next-eslint-plugin'
import tsPrefixer from 'eslint-config-ts-prefixer'
import reactYouMightNotNeedAnEffect from 'eslint-plugin-react-you-might-not-need-an-effect'
import { defineConfig } from 'eslint/config'

/**
 * Rules intentionally enabled for @laststance/react-next-eslint-plugin v2.2.0.
 * Keeping the list explicit means dependency upgrades cannot silently turn on a
 * new rule without a focused lint-fix pass in the same PR.
 */
const laststanceReactNextRuleNames = [
  'all-memo',
  'jsx-no-useless-fragment',
  'no-context-provider',
  'no-deopt-use-callback',
  'no-deopt-use-memo',
  'no-direct-use-effect',
  'no-duplicate-key',
  'no-forward-ref',
  'no-jsx-without-return',
  'no-missing-button-type',
  'no-missing-component-display-name',
  'no-missing-key',
  'no-nested-component-definitions',
  'no-set-state-prop-drilling',
  'no-use-reducer',
  'prefer-stable-context-value',
  'prefer-usecallback-for-memoized-component',
  'prefer-usecallback-might-work',
  'prefer-usememo-for-memoized-component',
  'prefer-usememo-might-work',
]

const laststanceReactNextRules = Object.fromEntries(
  laststanceReactNextRuleNames.map((ruleName) => [
    `@laststance/react-next/${ruleName}`,
    'error',
  ]),
)

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
      'coverage/**',
      '*.config.js',
      '*.config.ts',
      '*.config.mjs',
      '.storybook/**',
      'storybook-static/**',
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
      ...laststanceReactNextRules,
      // Keep the stricter prop-drilling depth while still enforcing the rule at error severity.
      '@laststance/react-next/no-set-state-prop-drilling': [
        'error',
        { depth: 1 },
      ],
    },
  },
])
