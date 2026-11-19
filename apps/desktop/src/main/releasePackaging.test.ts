import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { Packager } from 'electron-builder'
import { expect, test } from 'vitest'

const desktopDir = fileURLToPath(new URL('../..', import.meta.url))

test('the release packager accepts the workspace catalog and records the installed updater version', async () => {
  // Arrange
  const require = createRequire(import.meta.url)
  const updater = require('electron-updater/package.json') as {
    version: string
  }
  const packager = new Packager({ projectDir: desktopDir })

  // Act
  await packager.validateConfig()

  // Assert
  expect(packager.metadata.dependencies?.['electron-updater']).toBe(
    updater.version,
  )
})

test('the macOS signer leaves Chromium locale data to the framework seal and signs native code individually', async () => {
  // Arrange
  const packager = new Packager({ projectDir: desktopDir })
  const framework =
    'Skills Desktop.app/Contents/Frameworks/Electron Framework.framework/Versions/A'
  const frameworkResources =
    'Skills Desktop.app/Contents/Frameworks/Electron Framework.framework/Resources'
  await packager.validateConfig()
  const patterns = [packager.config.mac?.signIgnore ?? []].flat()

  // Act
  const sealedAsData = [
    `${framework}/Resources/cs.lproj/locale.pak`,
    `${framework}/Resources/bg_NEUTER.lproj/locale.pak`,
    `${frameworkResources}/ar_FEMININE.lproj/locale.pak`,
    `${framework}/Electron Framework`,
    `${framework}/Libraries/libEGL.dylib`,
    'Skills Desktop.app/Contents/Resources/native.node',
    'Skills Desktop.app/Contents/Resources/cs.lproj/locale.pak',
  ].filter((path) => patterns.some((pattern) => new RegExp(pattern).test(path)))

  // Assert
  expect(sealedAsData).toEqual([
    `${framework}/Resources/cs.lproj/locale.pak`,
    `${framework}/Resources/bg_NEUTER.lproj/locale.pak`,
    `${frameworkResources}/ar_FEMININE.lproj/locale.pak`,
  ])
})
