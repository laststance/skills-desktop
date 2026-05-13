import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * Shiki modules used by the skill file preview. Vitest browser mode reloads
 * tests when it discovers new optimized dependencies mid-run; keeping the
 * focused highlighter bundle explicit makes those component tests stable.
 */
const shikiPreviewDeps = [
  'shiki/core',
  'shiki/engine/javascript',
  'shiki/langs/bash.mjs',
  'shiki/langs/c.mjs',
  'shiki/langs/cpp.mjs',
  'shiki/langs/csharp.mjs',
  'shiki/langs/css.mjs',
  'shiki/langs/dockerfile.mjs',
  'shiki/langs/dotenv.mjs',
  'shiki/langs/fish.mjs',
  'shiki/langs/go.mjs',
  'shiki/langs/html.mjs',
  'shiki/langs/ini.mjs',
  'shiki/langs/java.mjs',
  'shiki/langs/javascript.mjs',
  'shiki/langs/json.mjs',
  'shiki/langs/jsonc.mjs',
  'shiki/langs/jsx.mjs',
  'shiki/langs/kotlin.mjs',
  'shiki/langs/lua.mjs',
  'shiki/langs/make.mjs',
  'shiki/langs/md.mjs',
  'shiki/langs/mdx.mjs',
  'shiki/langs/php.mjs',
  'shiki/langs/python.mjs',
  'shiki/langs/ruby.mjs',
  'shiki/langs/rust.mjs',
  'shiki/langs/scss.mjs',
  'shiki/langs/sql.mjs',
  'shiki/langs/swift.mjs',
  'shiki/langs/toml.mjs',
  'shiki/langs/tsx.mjs',
  'shiki/langs/typescript.mjs',
  'shiki/langs/xml.mjs',
  'shiki/langs/yaml.mjs',
  'shiki/langs/zsh.mjs',
  'shiki/themes/github-dark.mjs',
  'shiki/themes/github-light.mjs',
] as const

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
    // React and react-dom MUST resolve to a single instance. Without dedupe,
    // vitest-browser-react bundles its own copy while react-redux pulls the
    // root copy, leaving hook dispatchers disconnected and `useMemo` null.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    // Coverage config lives at the root so v8 merges results from both
    // node + browser projects into a single lcov report. Codecov consumes
    // `coverage/lcov.info`; `text` mirrors the same numbers in CI logs so
    // a regression is visible without opening codecov.io.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      // Exclusions follow the same intent as `.fallowrc.jsonc`: shadcn/ui
      // primitives are scaffolded as full kits (every export reserved for
      // future composition), and *.d.ts / test files don't carry runtime
      // logic worth measuring.
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.browser.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/renderer/src/components/ui/**',
      ],
    },
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': resolve(__dirname, './src'),
          },
          dedupe: ['react', 'react-dom'],
        },
        test: {
          name: 'node',
          include: ['src/**/*.test.{ts,tsx}'],
          exclude: ['src/**/*.browser.test.{ts,tsx}', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': resolve(__dirname, './src'),
          },
          // Browser project MUST dedupe explicitly — projects don't inherit
          // root-level resolve config. Without this, vitest-browser-react
          // bundles its own React, leaving Radix/react-redux pulling a
          // different React instance. useContext returns null, hooks crash.
          dedupe: ['react', 'react-dom'],
        },
        optimizeDeps: {
          // Pre-bundle heavy deps together so they share React instance in
          // the browser page. Without this, Radix packages get bundled lazily
          // with a stale React reference on first mount.
          include: [
            'react',
            'react-dom',
            'react-dom/client',
            'react/jsx-runtime',
            'react-redux',
            '@reduxjs/toolkit',
            'react-grid-layout',
            'react-resizable-panels',
            // Radix's controllable-state hook runs `useState` against whatever
            // React it sees first. If Vite bundles toggle-group lazily it grabs
            // a stale React copy and `useState` returns undefined → render
            // crash. Listing the package here forces it into the shared chunk.
            '@radix-ui/react-toggle-group',
            ...shikiPreviewDeps,
          ],
        },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
