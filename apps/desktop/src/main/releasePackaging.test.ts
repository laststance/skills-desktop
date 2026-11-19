import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { Packager } from 'electron-builder'
import { expect, test } from 'vitest'

test('the release packager accepts the workspace catalog and records the installed updater version', async () => {
  // Arrange
  const projectDir = fileURLToPath(new URL('../..', import.meta.url))
  const require = createRequire(import.meta.url)
  const updater = require('electron-updater/package.json') as {
    version: string
  }
  const packager = new Packager({ projectDir })

  // Act
  await packager.validateConfig()

  // Assert
  expect(packager.metadata.dependencies?.['electron-updater']).toBe(
    updater.version,
  )
})
