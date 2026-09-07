import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'
import sharp from 'sharp'

import type {
  BackgroundApplyInput,
  BackgroundApplySource,
  BackgroundCrop,
  BackgroundSelection,
  BackgroundUploadDraft,
} from '../../src/shared/backgrounds'
import { SettingsSchema } from '../../src/shared/settings'
import {
  UnsplashSearchInputSchema,
  UnsplashSearchResultSchema,
} from '../../website/src/lib/unsplash-contract'
import { expect, test } from '../fixtures/electron-app'
import { holdBackgroundApplyReply } from '../helpers/hold-background-apply-reply'
import { holdBackgroundRename } from '../helpers/hold-background-rename'
import {
  readSettingsFile,
  settingsFilePath,
  writeSettingsFile,
} from '../helpers/settings-file'

const galleryTest = test.extend<{
  settingsWindow: Page
  imagePath: string
}>({
  // A fresh profile avoids hardlinked skill fixtures; this suite mutates only its own files.
  // eslint-disable-next-line no-empty-pattern
  isolatedHome: async ({}, use) => {
    const isolatedHome = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'skills-e2e-backgrounds-')),
    )
    try {
      mkdirSync(join(isolatedHome, '.agents', 'skills'), { recursive: true })
      writeSettingsFile(isolatedHome, {
        windowOpacityMode: 'entire',
        windowBackgroundOpacityPercent: 100,
      })
      await use(isolatedHome)
    } finally {
      rmSync(isolatedHome, { recursive: true, force: true })
    }
  },
  imagePath: async ({ isolatedHome }, use) => {
    const imagePath = join(isolatedHome, 'gallery-fixture.png')
    const cropPixels = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: '#00ff00' },
    })
      .png()
      .toBuffer()
    await sharp({
      create: { width: 3840, height: 2160, channels: 3, background: '#ff0000' },
    })
      .composite([{ input: cropPixels, left: 960, top: 540 }])
      .png()
      .toFile(imagePath)
    await use(imagePath)
  },
  settingsWindow: async ({ electronApp, appWindow }, use) => {
    const settingsWindow = await openBackgroundSettings(electronApp, appWindow)
    await use(settingsWindow)
  },
})

/** Opens the actual native Settings window so assertions cross independent renderer processes.
 * @param electronApp - Test-owned app.
 * @param appWindow - Current main window, including a recreated one.
 * @returns The loaded Appearance page.
 * @example const settings = await openBackgroundSettings(app, mainWindow)
 */
async function openBackgroundSettings(
  electronApp: ElectronApplication,
  appWindow: Page,
): Promise<Page> {
  const opened = electronApp.waitForEvent('window')
  await appWindow.getByRole('button', { name: 'Open settings' }).click()
  const settingsWindow = await opened
  await settingsWindow.waitForLoadState('domcontentloaded')
  await settingsWindow
    .getByRole('button', { name: 'Appearance', exact: true })
    .click()
  return settingsWindow
}

/** Changes only the native picker answer, then invokes the production upload bridge and validation pipeline.
 * @param electronApp - Test-owned app with the real native picker.
 * @param rendererPage - Renderer that owns the new transient upload.
 * @param imagePath - Real image in this test's isolated HOME.
 * @returns Validated draft owned by the requesting window.
 * @example const draft = await importFixture(app, settings, imagePath)
 */
async function importFixture(
  electronApp: ElectronApplication,
  rendererPage: Page,
  imagePath: string,
): Promise<BackgroundUploadDraft> {
  const picker = await electronApp.evaluateHandle(({ dialog }, path) => {
    const originalPicker = dialog.showOpenDialog
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    return {
      restore: () => {
        dialog.showOpenDialog = originalPicker
      },
    }
  }, imagePath)
  try {
    const draft = await rendererPage.evaluate(async () =>
      window.electron.backgrounds.importImage(),
    )
    if (!draft) throw new Error('Fixture upload unexpectedly cancelled')
    return draft
  } finally {
    await picker.evaluate((nativePicker) => nativePicker.restore())
  }
}

/** Waits for the specific accepted operation rather than mistaking a prior success for the new Apply result.
 * @param rendererPage - Live renderer with the production bridge.
 * @param source - Owned or bundled input accepted by Main.
 * @param crop - Oriented source percentages; default retains the full image.
 * @returns The committed selection after the exact operation succeeds.
 * @example const selection = await applyFixture(settings, draft.source)
 */
async function applyFixture(
  rendererPage: Page,
  source: BackgroundApplySource,
  crop: BackgroundCrop = { x: 0, y: 0, width: 100, height: 100 },
): Promise<BackgroundSelection> {
  const accepted = await rendererPage.evaluate(
    async (input) => window.electron.backgrounds.apply(input),
    {
      requestId: randomUUID(),
      source,
      crop,
      aspect: 'original',
    } satisfies BackgroundApplyInput,
  )
  await expect
    .poll(async () => {
      const snapshot = await rendererPage.evaluate(async () =>
        window.electron.backgrounds.getSnapshot(),
      )
      return {
        operationId: snapshot.operation?.operationId,
        status: snapshot.operation?.status,
      }
    })
    .toEqual({ operationId: accepted.operationId, status: 'succeeded' })
  const snapshot = await rendererPage.evaluate(async () =>
    window.electron.backgrounds.getSnapshot(),
  )
  if (!snapshot.display) throw new Error('Succeeded background has no display')
  return snapshot.display.selection
}

/** Reads durable settings through the production schema, including legacy defaults before the first write.
 * @param isolatedHome - This test's private profile.
 * @returns Validated disk settings, independent of renderer state.
 * @example persistedSettings(home).background.selected
 */
function persistedSettings(isolatedHome: string) {
  return SettingsSchema.parse(readSettingsFile(isolatedHome))
}

galleryTest(
  'applies all four offline built-ins across windows and adjusts default opacity only once',
  async ({ electronApp, appWindow, settingsWindow, isolatedHome }) => {
    // Arrange
    const catalog = await settingsWindow.evaluate(async () =>
      window.electron.backgrounds.list(),
    )
    expect(
      catalog.builtins
        .map((item) =>
          item.source.kind === 'builtin' ? item.source.builtinId : '',
        )
        .sort(),
    ).toEqual(['alpine-lake', 'misty-forest', 'pacific-coast', 'quiet-dunes'])
    // Act / Assert — exercise every packaged asset through Main's real preparation and commit.
    for (const [index, item] of catalog.builtins.entries()) {
      const selected = await applyFixture(settingsWindow, item.source)
      await expect(appWindow.getByTestId('background-canvas')).toHaveCount(1)
      await expect(
        appWindow
          .getByTestId('background-canvas')
          .locator('[data-background-image]'),
      ).toHaveAttribute('data-background-state', 'ready')
      expect(persistedSettings(isolatedHome)).toMatchObject({
        background: { selected, hasAppliedImage: true },
        windowBackgroundOpacityPercent: index === 0 ? 60 : 85,
      })
      await expect
        .poll(
          async () =>
            (
              await appWindow.evaluate(async () =>
                window.electron.backgrounds.getSnapshot(),
              )
            ).display?.selection,
        )
        .toEqual(selected)
      await settingsWindow.evaluate(async () =>
        window.electron.settings.set({ windowBackgroundOpacityPercent: 85 }),
      )
    }
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((window) => window.getOpacity()),
      ),
    ).toEqual([1, 1])
  },
)

galleryTest(
  'cancelling a new upload restores the prior crop and deletes only unaccepted staging files',
  async ({ electronApp, settingsWindow, isolatedHome, imagePath }) => {
    // Arrange
    const priorCrop = { x: 10, y: 10, width: 80, height: 80 }
    const prior = await applyFixture(
      settingsWindow,
      { kind: 'builtin', builtinId: 'alpine-lake' },
      priorCrop,
    )
    const preview = await settingsWindow.evaluate(
      async (source) => window.electron.backgrounds.preview(source),
      prior.source,
    )
    await settingsWindow
      .getByRole('button', { name: 'Choose background', exact: true })
      .click()
    const picker = await electronApp.evaluateHandle(({ dialog }, path) => {
      const originalPicker = dialog.showOpenDialog
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
      return {
        restore: () => {
          dialog.showOpenDialog = originalPicker
        },
      }
    }, imagePath)
    const staging = join(isolatedHome, 'userData', 'backgrounds', 'staging')
    try {
      // Act
      await settingsWindow
        .getByRole('button', { name: 'Upload image', exact: true })
        .click()
      await expect(
        settingsWindow.getByRole('dialog', { name: 'Crop background' }),
      ).toBeVisible()
      expect(readdirSync(staging)).toHaveLength(1)
      await settingsWindow
        .getByRole('button', { name: 'Cancel', exact: true })
        .last()
        .click()
      // Assert
      await expect(
        settingsWindow.getByText(`Preview: ${preview.title}`, { exact: true }),
      ).toBeVisible()
      await expect.poll(() => readdirSync(staging)).toEqual([])
      expect(existsSync(imagePath)).toBe(true)
      expect(persistedSettings(isolatedHome).background).toMatchObject({
        selected: prior,
        uploads: [],
      })
      // Applying the restored draft proves Cancel retained its crop rather than only its thumbnail.
      const previousOperationId =
        (
          await settingsWindow.evaluate(async () =>
            window.electron.backgrounds.getSnapshot(),
          )
        ).operation?.operationId ?? 0
      await settingsWindow
        .getByRole('button', { name: 'Apply background', exact: true })
        .click()
      await expect
        .poll(async () => {
          const operation = (
            await settingsWindow.evaluate(async () =>
              window.electron.backgrounds.getSnapshot(),
            )
          ).operation
          return Boolean(
            operation &&
            operation.operationId > previousOperationId &&
            operation.status === 'succeeded',
          )
        })
        .toBe(true)
      await expect
        .poll(() => persistedSettings(isolatedHome).background.selected?.crop)
        .toEqual({ x: 10, y: 10, width: 80, height: 80 })
    } finally {
      await picker.evaluate((nativePicker) => nativePicker.restore())
    }
  },
)

galleryTest(
  'accepted upload survives both windows closing before the Apply reply and replays its result after recreation',
  async ({
    electronApp,
    appWindow,
    settingsWindow,
    isolatedHome,
    imagePath,
  }) => {
    // Arrange
    const draft = await importFixture(electronApp, settingsWindow, imagePath)
    const publication = await holdBackgroundRename(
      electronApp,
      join(isolatedHome, 'userData', 'backgrounds', 'displays'),
      'directory',
    )
    const reply = await holdBackgroundApplyReply(electronApp)
    const requestId = randomUUID()
    const pendingReply = settingsWindow
      .evaluate(async (input) => window.electron.backgrounds.apply(input), {
        requestId,
        source: draft.source,
        crop: { x: 0, y: 0, width: 100, height: 100 },
        aspect: 'original',
      } satisfies BackgroundApplyInput)
      .catch(() => null)
    try {
      await expect
        .poll(async () => reply.evaluate((held) => held.hasAccepted()))
        .toBe(true)
      await expect
        .poll(async () => publication.evaluate((held) => held.isHeld()))
        .toBe(true)
      // Act — these are actual BrowserWindow closures, not a renderer unmount or mocked callback.
      const nativeSettings = await electronApp.browserWindow(settingsWindow)
      await nativeSettings.evaluate((window) => window.close())
      const nativeMain = await electronApp.browserWindow(appWindow)
      await nativeMain.evaluate((window) => window.close())
      await expect
        .poll(async () =>
          electronApp.evaluate(
            ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
          ),
        )
        .toBe(0)
      await publication.evaluate((held) => held.release())
      await reply.evaluate((held) => held.release())
      await pendingReply
      // Assert — Main commits while no renderer exists; claimed input is not discarded with its old owner.
      await expect
        .poll(() => persistedSettings(isolatedHome).background.uploads.length)
        .toBe(1)
      const committed = persistedSettings(isolatedHome).background.selected
      expect(committed?.source.kind).toBe('upload')
      const recreated = electronApp.waitForEvent('window')
      await electronApp.evaluate(({ app }) => app.emit('activate'))
      const newMain = await recreated
      await newMain.waitForLoadState('domcontentloaded')
      const reopenedSettings = await openBackgroundSettings(
        electronApp,
        newMain,
      )
      await expect
        .poll(
          async () =>
            (
              await reopenedSettings.evaluate(async () =>
                window.electron.backgrounds.getSnapshot(),
              )
            ).operation,
        )
        .toMatchObject({ requestId, status: 'succeeded' })
      expect(
        (
          await newMain.evaluate(async () =>
            window.electron.backgrounds.getSnapshot(),
          )
        ).display?.selection,
      ).toEqual(committed)
      expect(existsSync(imagePath)).toBe(true)
    } finally {
      await reply.evaluate((held) => held.restore())
      await publication.evaluate((held) => held.restore())
    }
  },
)

galleryTest(
  'removing the upload being recropped prevents stale preparation from resurrecting its reference',
  async ({ electronApp, settingsWindow, isolatedHome, imagePath }) => {
    // Arrange
    const draft = await importFixture(electronApp, settingsWindow, imagePath)
    const selected = await applyFixture(settingsWindow, draft.source)
    if (selected.source.kind !== 'upload')
      throw new Error('Fixture was not committed as an upload')
    const uploadId = selected.source.uploadId
    const publication = await holdBackgroundRename(
      electronApp,
      join(isolatedHome, 'userData', 'backgrounds', 'displays'),
      'directory',
    )
    try {
      const accepted = await settingsWindow.evaluate(
        async (input) => window.electron.backgrounds.apply(input),
        {
          requestId: randomUUID(),
          source: selected.source,
          crop: { x: 25, y: 25, width: 50, height: 50 },
          aspect: 'original',
        } satisfies BackgroundApplyInput,
      )
      await expect
        .poll(async () => publication.evaluate((held) => held.isHeld()))
        .toBe(true)
      // Act — image cleanup may wait behind preparation; assert the real removal commit before releasing it.
      const removing = settingsWindow.evaluate(
        async (id) =>
          window.electron.backgrounds.removeUpload({ uploadId: id }),
        uploadId,
      )
      await expect
        .poll(() => persistedSettings(isolatedHome).background)
        .toMatchObject({ selected: null, uploads: [] })
      await publication.evaluate((held) => held.release())
      await removing
      // Assert
      await expect
        .poll(async () => publication.evaluate((held) => held.hasCompleted()))
        .toBe(true)
      await expect
        .poll(() =>
          readdirSync(
            join(isolatedHome, 'userData', 'backgrounds', 'displays'),
          ),
        )
        .toEqual([])
      await expect
        .poll(
          async () =>
            (
              await settingsWindow.evaluate(async () =>
                window.electron.backgrounds.getSnapshot(),
              )
            ).operation,
        )
        .toMatchObject({
          operationId: accepted.operationId,
          status: 'superseded',
        })
      expect(persistedSettings(isolatedHome).background).toMatchObject({
        selected: null,
        uploads: [],
        hasAppliedImage: true,
      })
      expect(
        existsSync(
          join(isolatedHome, 'userData', 'backgrounds', 'uploads', uploadId),
        ),
      ).toBe(false)
      expect(existsSync(imagePath)).toBe(true)
      await expect(
        settingsWindow.locator('[data-sonner-toast][data-type="error"]'),
      ).toHaveCount(0)
    } finally {
      await publication.evaluate((held) => held.restore())
    }
  },
)

galleryTest(
  'removing the current upload preserves an unrelated pending Apply and both durable intents',
  async ({ electronApp, settingsWindow, isolatedHome, imagePath }) => {
    // Arrange
    const firstDraft = await importFixture(
      electronApp,
      settingsWindow,
      imagePath,
    )
    const first = await applyFixture(settingsWindow, firstDraft.source)
    const secondDraft = await importFixture(
      electronApp,
      settingsWindow,
      imagePath,
    )
    const second = await applyFixture(settingsWindow, secondDraft.source)
    await applyFixture(settingsWindow, first.source)
    if (first.source.kind !== 'upload' || second.source.kind !== 'upload')
      throw new Error('Fixture uploads were not committed')
    const firstId = first.source.uploadId
    const secondId = second.source.uploadId
    const publication = await holdBackgroundRename(
      electronApp,
      join(isolatedHome, 'userData', 'backgrounds', 'displays'),
      'directory',
    )
    try {
      const accepted = await settingsWindow.evaluate(
        async (input) => window.electron.backgrounds.apply(input),
        {
          requestId: randomUUID(),
          source: second.source,
          crop: { x: 25, y: 25, width: 50, height: 50 },
          aspect: 'original',
        } satisfies BackgroundApplyInput,
      )
      await expect
        .poll(async () => publication.evaluate((held) => held.isHeld()))
        .toBe(true)
      // Act
      const removing = settingsWindow.evaluate(
        async (id) =>
          window.electron.backgrounds.removeUpload({ uploadId: id }),
        firstId,
      )
      await expect
        .poll(() =>
          persistedSettings(isolatedHome).background.uploads.map(
            (upload) => upload.id,
          ),
        )
        .toEqual([secondId])
      await publication.evaluate((held) => held.release())
      await removing
      // Assert
      await expect
        .poll(
          async () =>
            (
              await settingsWindow.evaluate(async () =>
                window.electron.backgrounds.getSnapshot(),
              )
            ).operation,
        )
        .toMatchObject({
          operationId: accepted.operationId,
          status: 'succeeded',
        })
      expect(persistedSettings(isolatedHome).background).toMatchObject({
        selected: { source: { kind: 'upload', uploadId: secondId } },
      })
      expect(
        persistedSettings(isolatedHome).background.uploads.map(
          (upload) => upload.id,
        ),
      ).toEqual([secondId])
      expect(
        existsSync(
          join(isolatedHome, 'userData', 'backgrounds', 'uploads', firstId),
        ),
      ).toBe(false)
    } finally {
      await publication.evaluate((held) => held.restore())
    }
  },
)

galleryTest(
  'Clear before first publication preserves no image, unused first-apply state and 100 percent opacity',
  async ({ electronApp, settingsWindow, isolatedHome }) => {
    // Arrange
    const publication = await holdBackgroundRename(
      electronApp,
      join(isolatedHome, 'userData', 'backgrounds', 'displays'),
      'directory',
    )
    try {
      await settingsWindow.evaluate(
        async (requestId) =>
          window.electron.backgrounds.apply({
            requestId,
            source: { kind: 'builtin', builtinId: 'alpine-lake' },
            crop: { x: 0, y: 0, width: 100, height: 100 },
            aspect: 'original',
          }),
        randomUUID(),
      )
      await expect
        .poll(async () => publication.evaluate((held) => held.isHeld()))
        .toBe(true)
      // Act
      await settingsWindow.evaluate(async () =>
        window.electron.backgrounds.clear(),
      )
      await publication.evaluate((held) => held.release())
      // Assert
      await expect
        .poll(async () => publication.evaluate((held) => held.hasCompleted()))
        .toBe(true)
      await expect
        .poll(() =>
          readdirSync(
            join(isolatedHome, 'userData', 'backgrounds', 'displays'),
          ),
        )
        .toEqual([])
      await expect
        .poll(
          async () =>
            (
              await settingsWindow.evaluate(async () =>
                window.electron.backgrounds.getSnapshot(),
              )
            ).operation?.status,
        )
        .toBe('superseded')
      expect(persistedSettings(isolatedHome)).toMatchObject({
        background: { selected: null, hasAppliedImage: false },
        windowBackgroundOpacityPercent: 100,
      })
    } finally {
      await publication.evaluate((held) => held.restore())
    }
  },
)

galleryTest(
  'Clear queued after the first commit boundary retains the successful first-use opacity adjustment',
  async ({ electronApp, settingsWindow, isolatedHome }) => {
    // Arrange
    const commit = await holdBackgroundRename(
      electronApp,
      settingsFilePath(isolatedHome),
      'file',
    )
    try {
      await settingsWindow.evaluate(
        async (requestId) =>
          window.electron.backgrounds.apply({
            requestId,
            source: { kind: 'builtin', builtinId: 'alpine-lake' },
            crop: { x: 0, y: 0, width: 100, height: 100 },
            aspect: 'original',
          }),
        randomUUID(),
      )
      await expect
        .poll(async () => commit.evaluate((held) => held.isHeld()))
        .toBe(true)
      // Act — first Apply has passed its queue check; Clear must follow that actual atomic write.
      const clearing = settingsWindow.evaluate(async () =>
        window.electron.backgrounds.clear(),
      )
      await commit.evaluate((held) => held.release())
      await clearing
      // Assert
      expect(persistedSettings(isolatedHome)).toMatchObject({
        background: { selected: null, hasAppliedImage: true },
        windowBackgroundOpacityPercent: 60,
      })
      expect(
        (
          await settingsWindow.evaluate(async () =>
            window.electron.backgrounds.getSnapshot(),
          )
        ).display,
      ).toBeNull()
    } finally {
      await commit.evaluate((held) => held.restore())
    }
  },
)

galleryTest(
  'stores only crop pixels and reopens the owned source after its external original moves',
  async ({ electronApp, settingsWindow, isolatedHome, imagePath }) => {
    // Arrange
    const draft = await importFixture(electronApp, settingsWindow, imagePath)
    // Act
    const selected = await applyFixture(settingsWindow, draft.source, {
      x: 25,
      y: 25,
      width: 50,
      height: 50,
    })
    if (!selected.displayId)
      throw new Error('Local crop has no prepared display')
    const displayPath = join(
      isolatedHome,
      'userData',
      'backgrounds',
      'displays',
      `${selected.displayId}.webp`,
    )
    const metadata = await sharp(displayPath).metadata()
    const pixels = await sharp(displayPath).stats()
    await rename(imagePath, join(isolatedHome, 'moved-original.png'))
    const preview = await settingsWindow.evaluate(
      async (source) => window.electron.backgrounds.preview(source),
      selected.source,
    )
    // Assert — excluded red borders must not survive in the real published crop, even at its edges.
    expect({ width: metadata.width, height: metadata.height }).toEqual({
      width: 1920,
      height: 1080,
    })
    expect(pixels.channels[0].max).toBeLessThanOrEqual(5)
    expect(pixels.channels[1].min).toBeGreaterThanOrEqual(250)
    expect(pixels.channels[2].max).toBeLessThanOrEqual(5)
    expect({ width: preview.width, height: preview.height }).toEqual({
      width: 3840,
      height: 2160,
    })
    expect(persistedSettings(isolatedHome).background.selected?.crop).toEqual({
      x: 25,
      y: 25,
      width: 50,
      height: 50,
    })
    await settingsWindow
      .getByRole('button', { name: 'Crop', exact: true })
      .click()
    await expect(
      settingsWindow.getByRole('dialog', { name: 'Crop background' }),
    ).toBeVisible()
  },
)

galleryTest(
  'shows a real undersized upload rejection while keeping the committed image and user original',
  async ({ electronApp, settingsWindow, isolatedHome }) => {
    // Arrange
    const selected = await applyFixture(settingsWindow, {
      kind: 'builtin',
      builtinId: 'alpine-lake',
    })
    const imagePath = join(isolatedHome, 'too-small.png')
    await sharp({
      create: { width: 1919, height: 1080, channels: 3, background: '#305976' },
    })
      .png()
      .toFile(imagePath)
    const picker = await electronApp.evaluateHandle(({ dialog }, path) => {
      const originalPicker = dialog.showOpenDialog
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      })
      return {
        restore: () => {
          dialog.showOpenDialog = originalPicker
        },
      }
    }, imagePath)
    try {
      // Act
      await settingsWindow
        .getByRole('button', { name: 'Choose background', exact: true })
        .click()
      await settingsWindow
        .getByRole('button', { name: 'Upload image', exact: true })
        .click()
      // Assert
      await expect(
        settingsWindow
          .locator('[data-sonner-toast]')
          .filter({ hasText: '1920' }),
      ).toBeVisible()
      expect(persistedSettings(isolatedHome).background).toMatchObject({
        selected,
        uploads: [],
      })
      expect(existsSync(imagePath)).toBe(true)
      await expect(
        settingsWindow.getByRole('dialog', { name: 'Crop background' }),
      ).toHaveCount(0)
    } finally {
      await picker.evaluate((nativePicker) => nativePicker.restore())
    }
  },
)

galleryTest(
  'blocks DOM-injected scripts in both file renderers while the real application remains usable',
  async ({ appWindow, settingsWindow }) => {
    // Arrange — Electron launches without CSP bypass; each native window loads the generated production HTML.
    for (const rendererPage of [appWindow, settingsWindow]) {
      expect(new URL(rendererPage.url()).protocol).toBe('file:')
      // Act — unlike page.evaluate, a script element must satisfy the document's actual policy.
      await expect(
        rendererPage.addScriptTag({
          content:
            "document.documentElement.dataset.backgroundCspProbe = 'executed'",
        }),
      ).rejects.toThrow(/content security policy/i)
      // Assert — rejection cannot be mistaken for a script that already executed.
      expect(
        await rendererPage.evaluate(() =>
          document.documentElement.getAttribute('data-background-csp-probe'),
        ),
      ).toBeNull()
    }
    await expect(
      appWindow.getByRole('button', { name: 'Open settings' }),
    ).toBeVisible()
    await expect(
      settingsWindow.getByRole('button', {
        name: 'Choose background',
        exact: true,
      }),
    ).toBeVisible()
  },
)

galleryTest(
  'shows background save failure in both windows and retries the retained crop without consuming first use',
  async ({ appWindow, settingsWindow, isolatedHome }) => {
    // Arrange — a directory at the owned temporary settings path forces a real disk-write failure.
    const temporaryPath = `${settingsFilePath(isolatedHome)}.tmp`
    mkdirSync(temporaryPath)
    await settingsWindow
      .getByRole('button', { name: 'Choose background', exact: true })
      .click()
    await settingsWindow
      .getByRole('radio', { name: 'Alpine lake', exact: true })
      .click()
    // Act
    await settingsWindow
      .getByRole('button', { name: 'Apply background', exact: true })
      .click()
    // Assert — actual operation events reach the visible Toaster in each renderer.
    for (const rendererPage of [appWindow, settingsWindow]) {
      await expect(
        rendererPage.getByText('Background could not be applied', {
          exact: true,
        }),
      ).toBeVisible()
    }
    expect(persistedSettings(isolatedHome)).toMatchObject({
      background: { selected: null, uploads: [], hasAppliedImage: false },
      windowBackgroundOpacityPercent: 100,
    })
    const failed = await settingsWindow.evaluate(async () =>
      window.electron.backgrounds.getSnapshot(),
    )
    expect(failed.operation).toMatchObject({
      status: 'failed',
      source: { kind: 'builtin', builtinId: 'alpine-lake' },
      crop: { x: 0, y: 0, width: 100, height: 100 },
      aspect: 'original',
    })
    // Act — remove only this test's failure fixture; the retained operation supplies Retry's exact input.
    rmSync(temporaryPath, { recursive: true })
    await settingsWindow
      .getByRole('button', { name: 'Retry Apply', exact: true })
      .click()
    // Assert
    await expect
      .poll(() => persistedSettings(isolatedHome))
      .toMatchObject({
        background: {
          selected: {
            source: { kind: 'builtin', builtinId: 'alpine-lake' },
            crop: { x: 0, y: 0, width: 100, height: 100 },
          },
          hasAppliedImage: true,
        },
        windowBackgroundOpacityPercent: 60,
      })
    for (const rendererPage of [appWindow, settingsWindow]) {
      await expect(
        rendererPage.getByText('Background applied', { exact: true }),
      ).toBeVisible()
    }
  },
)

galleryTest(
  'keeps intentional search focus when a virtual photo target arrives after keyboard navigation and compact resize',
  async ({ electronApp, settingsWindow }) => {
    // Arrange — mock only the public HTTP/CDN boundary; the real query client, virtualizer, IPC and CSP stay active.
    const requests: Array<{ origin: string | undefined; page: number }> = []
    const pageErrors: string[] = []
    settingsWindow.on('pageerror', (error) => pageErrors.push(error.message))
    const thumbnail = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#305976' },
    })
      .png()
      .toBuffer()
    await settingsWindow
      .context()
      .route('https://images.unsplash.com/**', async (route) =>
        route.fulfill({
          status: 200,
          contentType: 'image/png',
          body: thumbnail,
        }),
      )
    await settingsWindow
      .context()
      .route(
        'https://skills-desktop.vercel.app/api/rpc/unsplash/search',
        async (route) => {
          if (route.request().method() === 'OPTIONS') {
            await route.fulfill({
              status: 204,
              headers: {
                'Access-Control-Allow-Origin': 'null',
                'Access-Control-Allow-Methods': 'POST',
                'Access-Control-Allow-Headers': 'content-type',
              },
            })
            return
          }
          const input = UnsplashSearchInputSchema.parse(
            route.request().postDataJSON().json,
          )
          requests.push({
            origin: route.request().headers().origin,
            page: input.page,
          })
          const result = UnsplashSearchResultSchema.parse({
            items: Array.from({ length: 30 }, (_, index) => {
              const id = `fixture-${input.page}-${index}`
              return {
                id,
                width: 3840,
                height: 2160,
                description: null,
                altDescription: `Fixture ${input.page}:${index}`,
                urls: {
                  raw: `https://images.unsplash.com/photo-${id}?ixid=fixture`,
                  small: `https://images.unsplash.com/photo-${id}?ixid=fixture&w=400`,
                },
                links: {
                  html: `https://unsplash.com/photos/${id}?utm_source=skills-desktop&utm_medium=referral`,
                  downloadLocation: `https://api.unsplash.com/photos/${id}/download?ixid=fixture`,
                },
                photographer: {
                  name: 'Fixture photographer',
                  username: 'fixture',
                  profileUrl:
                    'https://unsplash.com/@fixture?utm_source=skills-desktop&utm_medium=referral',
                },
              }
            }),
            nextPage: input.page < 3 ? input.page + 1 : null,
          })
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': 'null' },
            body: JSON.stringify({ json: result }),
          })
        },
      )
    await settingsWindow
      .getByRole('button', { name: 'Choose background', exact: true })
      .click()
    await settingsWindow
      .getByRole('tab', { name: 'Unsplash', exact: true })
      .click()
    await expect(
      settingsWindow.getByRole('radio', { name: 'Fixture 1:0', exact: true }),
    ).toBeVisible()
    await expect
      .poll(async () =>
        settingsWindow
          .getByRole('radio', { name: 'Fixture 1:0', exact: true })
          .locator('img')
          .evaluate((node) =>
            node instanceof HTMLImageElement ? node.naturalWidth : 0,
          ),
      )
      .toBe(8)
    // Act — move focus intentionally within the same event turn, before the virtual target's animation-frame callback.
    await settingsWindow.evaluate(() => {
      const firstPhoto = document.querySelector<HTMLButtonElement>(
        '[role="radiogroup"] [role="radio"]',
      )
      const search =
        document.querySelector<HTMLInputElement>('#background-search')
      if (!firstPhoto || !search)
        throw new Error('Gallery keyboard controls are missing')
      firstPhoto.focus()
      firstPhoto.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      )
      search.focus()
    })
    const nativeSettings = await electronApp.browserWindow(settingsWindow)
    await nativeSettings.evaluate((window) =>
      window.setBounds({ width: 600, height: 400 }),
    )
    await settingsWindow.evaluate(
      async () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    )
    // Assert — actual renderer focus and bounded DOM prove that stale navigation did not reclaim the search box.
    await expect(
      settingsWindow.getByRole('searchbox', { name: 'Search Unsplash' }),
    ).toBeFocused()
    expect(
      await settingsWindow.locator('[data-background-photo-row]').count(),
    ).toBeLessThan(12)
    expect(
      await settingsWindow
        .getByRole('radiogroup', { name: 'Background photos' })
        .getByRole('radio')
        .count(),
    ).toBeLessThan(30)
    await expect(
      settingsWindow.getByRole('button', {
        name: 'Apply background',
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      settingsWindow
        .getByRole('button', { name: 'Cancel', exact: true })
        .last(),
    ).toBeInViewport()
    expect(requests[0]).toEqual({ origin: 'null', page: 1 })
    expect(
      pageErrors.filter((message) =>
        /range|out.of.bounds|scrollToRow/i.test(message),
      ),
    ).toEqual([])
  },
)
