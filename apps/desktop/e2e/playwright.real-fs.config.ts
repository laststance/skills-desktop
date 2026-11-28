import { resolve } from 'node:path'

import { defineConfig } from '@playwright/test'

const e2eRoot = __dirname

export default defineConfig({
  // Deliberately separate from `spec/`: the default lane must stay hermetic.
  testDir: resolve(e2eRoot, 'spec-real'),
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  outputDir: resolve(e2eRoot, 'test-results-real-fs'),
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
})
