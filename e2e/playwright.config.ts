import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

const e2eRoot = __dirname

export default defineConfig({
  testDir: resolve(e2eRoot, 'spec'),
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  globalSetup: resolve(e2eRoot, 'global-setup.ts'),
  globalTeardown: resolve(e2eRoot, 'global-teardown.ts'),
  outputDir: resolve(e2eRoot, 'test-results'),
  reporter: process.env.CI
    ? [
        ['list'],
        [
          'html',
          {
            outputFolder: resolve(e2eRoot, 'playwright-report'),
            open: 'never',
          },
        ],
      ]
    : 'list',
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
})
