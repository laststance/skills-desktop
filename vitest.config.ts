import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@shared': resolve(__dirname, './src/shared'),
    },
    // React and react-dom MUST resolve to a single instance. Without dedupe,
    // vitest-browser-react bundles its own copy while react-redux pulls the
    // root copy, leaving hook dispatchers disconnected and `useMemo` null.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': resolve(__dirname, './src'),
            '@shared': resolve(__dirname, './src/shared'),
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
            '@shared': resolve(__dirname, './src/shared'),
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
