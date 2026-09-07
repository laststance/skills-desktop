import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  type BackgroundApplyInput,
  type BackgroundApplySource,
} from '@/shared/backgrounds'
import { DEFAULT_SETTINGS, SettingsSchema } from '@/shared/settings'

import type * as ImagesModule from './backgroundImages'
import type * as BackgroundsModule from './backgrounds'
import type * as SettingsModule from './settings'

const native = vi.hoisted(() => ({
  userData: '',
  mainSend: vi.fn(),
  settingsSend: vi.fn(),
  windowsClosed: false,
}))
vi.mock('electron', () => ({
  app: {
    getPath: () => native.userData,
    getAppPath: () => join(process.cwd(), 'out', 'main'),
    isPackaged: false,
  },
  BrowserWindow: {
    getAllWindows: () =>
      native.windowsClosed
        ? []
        : [native.mainSend, native.settingsSend].map((send) => ({
            isDestroyed: () => false,
            webContents: { isDestroyed: () => false, send },
          })),
  },
}))

let images: typeof ImagesModule
let backgrounds: typeof BackgroundsModule
let settings: typeof SettingsModule
let directory: string
let fixture: string
let fixtureBytes: Buffer

/** Makes an explicit asynchronous boundary without timing-dependent sleeps in race regressions.
 * @returns A promise and its one-shot release.
 * @example const gate = deferred(); gate.resolve()
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {}
  const promise = new Promise<void>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

/** Gives each user action a fresh ID while keeping the crop's source coordinates explicit.
 * @returns A valid full-source Apply request.
 * @example applicationInput(draft.source)
 */
function applicationInput(source: BackgroundApplySource): BackgroundApplyInput {
  return {
    requestId: randomUUID(),
    source,
    crop: { x: 0, y: 0, width: 100, height: 100 },
    aspect: 'original',
  }
}

/** Waits for the observable replayed result instead of asserting internal service calls.
 * @returns The finished snapshot after Main publishes its result.
 * @example await waitForApplication('failed')
 */
async function waitForApplication(
  status: 'succeeded' | 'failed',
): Promise<void> {
  await vi.waitFor(
    () =>
      expect(backgrounds.getBackgroundSnapshot().operation?.status).toBe(
        status,
      ),
    { timeout: 5000 },
  )
}

/** Runs actual decoding/publication around an explicit preparation pause for supersession tests.
 * @returns Entry and release gates for the next local crop preparation.
 * @example const pause = pausePreparation(); await pause.entered.promise
 */
function pausePreparation(): {
  entered: ReturnType<typeof deferred>
  release: ReturnType<typeof deferred>
} {
  const entered = deferred()
  const release = deferred()
  const prepare = images.prepareBackgroundDisplay
  vi.spyOn(images, 'prepareBackgroundDisplay').mockImplementationOnce(
    async (...args) => {
      entered.resolve()
      await release.promise
      return prepare(...args)
    },
  )
  return { entered, release }
}

/** Pauses the real settings rename after its final intent check, leaving all image files and the old JSON inspectable.
 * @returns Entry/release gates for exactly one durable replacement.
 * @example const pause = pauseSettingsRename(); await pause.entered.promise
 */
function pauseSettingsRename(): {
  entered: ReturnType<typeof deferred>
  release: ReturnType<typeof deferred>
} {
  const entered = deferred()
  const release = deferred()
  const rename = fs.rename
  let paused = false
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (to === join(native.userData, 'settings.json') && !paused) {
      paused = true
      entered.resolve()
      await release.promise
    }
    return rename(from, to)
  })
  return { entered, release }
}

/** Reads the actual persisted contract so transaction tests prove disk/cache agreement.
 * @returns Validated settings from the isolated profile.
 * @example (await diskSettings()).background.hasAppliedImage
 */
async function diskSettings(): Promise<
  ReturnType<typeof SettingsSchema.parse>
> {
  return SettingsSchema.parse(
    JSON.parse(
      await fs.readFile(join(native.userData, 'settings.json'), 'utf8'),
    ),
  )
}

/** Saves a real uploaded source through Apply for library/removal scenarios.
 * @returns Its stable owned upload ID.
 * @example const uploadId = await addUpload()
 */
async function addUpload(): Promise<string> {
  const draft = await images.importBackgroundImage(fixture, 1)
  backgrounds.applyBackground(applicationInput(draft.source))
  await waitForApplication('succeeded')
  const source = settings.getSettings().background.selected?.source
  if (source?.kind !== 'upload') throw new Error('Upload was not committed')
  return source.uploadId
}

beforeEach(async () => {
  vi.resetModules()
  native.mainSend.mockReset()
  native.settingsSend.mockReset()
  native.windowsClosed = false
  directory = await fs.mkdtemp(
    join(tmpdir(), 'skills-background-transactions-'),
  )
  native.userData = join(directory, 'profile')
  fixture = join(directory, 'external-original.png')
  fixtureBytes = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: '#3272b8' },
  })
    .png()
    .toBuffer()
  await fs.writeFile(fixture, fixtureBytes)
  settings = await import('./settings')
  images = await import('./backgroundImages')
  backgrounds = await import('./backgrounds')
  await settings.loadSettings()
  await backgrounds.initializeBackgrounds()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await backgrounds.clearBackground()
  await images.discardBackgroundDraftsForOwner(1)
  await fs.rm(directory, { recursive: true, force: true })
})

describe('Main-owned background application transactions', () => {
  test('atomically publishes the uploaded source, crop and first Entire opacity while preserving hidden values', async () => {
    // Arrange
    await settings.saveSettings({
      leftSectionOpacityPercent: 71,
      defaultSkillTab: 'info',
    })
    const draft = await images.importBackgroundImage(fixture, 1)
    // Act
    const acceptance = backgrounds.applyBackground(
      applicationInput(draft.source),
    )
    await waitForApplication('succeeded')
    const saved = await diskSettings()
    // Assert
    expect(acceptance.operationId).toBe(1)
    expect(saved.windowBackgroundOpacityPercent).toBe(60)
    expect(saved.leftSectionOpacityPercent).toBe(71)
    expect(saved.defaultSkillTab).toBe('info')
    expect(saved.background).toMatchObject({
      layout: 'fill',
      hasAppliedImage: true,
      selected: {
        source: { kind: 'upload' },
        crop: { x: 0, y: 0, width: 100, height: 100 },
      },
      uploads: [{ width: 2400, height: 1600 }],
    })
    const upload = saved.background.uploads[0]
    expect(
      await fs.readFile(
        join(native.userData, 'backgrounds/uploads', upload.id, 'original'),
      ),
    ).toEqual(fixtureBytes)
    expect(await fs.readFile(fixture)).toEqual(fixtureBytes)
    expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
      status: 'succeeded',
      opacityAdjusted: true,
    })
    expect(backgrounds.getBackgroundSnapshot().display?.crop).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    expect(native.mainSend).toHaveBeenCalledWith('settings:changed', {
      settings: saved,
    })
    expect(native.settingsSend).toHaveBeenCalledWith(
      'backgrounds:changed',
      backgrounds.getBackgroundSnapshot(),
    )
  })

  test.each([
    {
      mode: 'entire' as const,
      entire: 85,
      left: 100,
      center: 100,
      right: 100,
      expected: [85, 100, 100, 100],
      adjusted: false,
    },
    {
      mode: 'section' as const,
      entire: 94,
      left: 100,
      center: 100,
      right: 100,
      expected: [94, 60, 60, 60],
      adjusted: true,
    },
    {
      mode: 'section' as const,
      entire: 100,
      left: 100,
      center: 80,
      right: 100,
      expected: [100, 100, 80, 100],
      adjusted: false,
    },
  ])(
    'preserves custom/hidden opacity for first $mode application with active values $entire/$left/$center/$right',
    async ({ mode, entire, left, center, right, expected, adjusted }) => {
      // Arrange
      await settings.saveSettings({
        windowOpacityMode: mode,
        windowBackgroundOpacityPercent: entire,
        leftSectionOpacityPercent: left,
        centerSectionOpacityPercent: center,
        rightSectionOpacityPercent: right,
      })
      const draft = await images.importBackgroundImage(fixture, 1)
      // Act
      backgrounds.applyBackground(applicationInput(draft.source))
      await waitForApplication('succeeded')
      const saved = await diskSettings()
      // Assert
      expect([
        saved.windowBackgroundOpacityPercent,
        saved.leftSectionOpacityPercent,
        saved.centerSectionOpacityPercent,
        saved.rightSectionOpacityPercent,
      ]).toEqual(expected)
      expect(saved.background.hasAppliedImage).toBe(true)
      expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
        opacityAdjusted: adjusted,
      })
    },
  )

  test('keeps the first-use flag and later custom opacity after Clear and a second Apply', async () => {
    // Arrange
    const uploadId = await addUpload()
    await settings.saveSettings({ windowBackgroundOpacityPercent: 100 })
    await backgrounds.setBackgroundLayout('tile')
    // Act
    await backgrounds.clearBackground()
    backgrounds.applyBackground(applicationInput({ kind: 'upload', uploadId }))
    await waitForApplication('succeeded')
    // Assert
    expect((await diskSettings()).background).toMatchObject({
      layout: 'tile',
      hasAppliedImage: true,
      uploads: [{ id: uploadId }],
    })
    expect(settings.getSettings().windowBackgroundOpacityPercent).toBe(100)
    expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
      opacityAdjusted: false,
    })
  })

  test('claims before returning acceptance so closing both windows and a late Cancel preserve the accepted source', async () => {
    // Arrange
    const draft = await images.importBackgroundImage(fixture, 1)
    const input = applicationInput(draft.source)
    const pause = pausePreparation()
    // Act
    const acceptance = backgrounds.applyBackground(input)
    native.windowsClosed = true
    await images.discardBackgroundDraftsForOwner(1)
    await images.discardBackgroundDraft(draft.source.draftId)
    await pause.entered.promise
    expect((await images.getBackgroundPreview(draft.source, [])).width).toBe(
      2400,
    )
    pause.release.resolve()
    await waitForApplication('succeeded')
    // Assert
    expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
      operationId: acceptance.operationId,
      status: 'succeeded',
    })
    expect((await diskSettings()).background.uploads).toHaveLength(1)
    expect(await fs.readFile(fixture)).toEqual(fixtureBytes)
  })

  test('deduplicates a double Apply without claiming the draft twice or adding a second library item', async () => {
    // Arrange
    const draft = await images.importBackgroundImage(fixture, 1)
    const input = applicationInput(draft.source)
    // Act
    const first = backgrounds.applyBackground(input)
    const duplicate = backgrounds.applyBackground(input)
    await waitForApplication('succeeded')
    const replay = backgrounds.applyBackground(input)
    // Assert
    expect(duplicate).toEqual({ operationId: 1, requestId: input.requestId })
    expect(replay).toEqual(first)
    expect((await diskSettings()).background.uploads).toHaveLength(1)
  })

  test('rejects an unknown draft before accepting any operation or touching persisted preferences', async () => {
    // Arrange
    const input = applicationInput({
      kind: 'upload-draft',
      draftId: randomUUID(),
    })
    // Act / Assert
    expect(() => backgrounds.applyBackground(input)).toThrow('expired')
    expect(backgrounds.getBackgroundSnapshot().operation).toBeNull()
    expect(settings.getSettings().background.hasAppliedImage).toBe(false)
    await expect(
      fs.access(join(native.userData, 'settings.json')),
    ).rejects.toThrow()
  })

  test('a delayed duplicate of accepted A cannot supersede a newer accepted B or reclaim the old input', async () => {
    // Arrange
    const first = await images.importBackgroundImage(fixture, 1)
    const second = await images.importBackgroundImage(fixture, 1)
    const firstInput = applicationInput(first.source)
    const pause = pausePreparation()
    const acceptedFirst = backgrounds.applyBackground(firstInput)
    await pause.entered.promise
    const acceptedSecond = backgrounds.applyBackground(
      applicationInput(second.source),
    )
    // Act
    const duplicateFirst = backgrounds.applyBackground(firstInput)
    pause.release.resolve()
    await waitForApplication('succeeded')
    // Assert
    expect(duplicateFirst).toEqual(acceptedFirst)
    expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
      operationId: acceptedSecond.operationId,
      status: 'succeeded',
      source: second.source,
    })
    expect((await diskSettings()).background.uploads).toHaveLength(1)
  })

  test('Clear during preparation leaves first-use opacity untouched and removes only the abandoned owned draft', async () => {
    // Arrange
    const draft = await images.importBackgroundImage(fixture, 1)
    const pause = pausePreparation()
    backgrounds.applyBackground(applicationInput(draft.source))
    await pause.entered.promise
    // Act
    await backgrounds.clearBackground()
    pause.release.resolve()
    // Assert
    await vi.waitFor(async () =>
      expect(
        await fs.readdir(join(native.userData, 'backgrounds/staging')),
      ).toEqual([]),
    )
    expect(settings.getSettings().background).toEqual({
      selected: null,
      layout: 'fill',
      uploads: [],
      hasAppliedImage: false,
    })
    expect(settings.getSettings().windowBackgroundOpacityPercent).toBe(100)
    expect(backgrounds.getBackgroundSnapshot().operation?.status).toBe(
      'superseded',
    )
    expect(await fs.readFile(fixture)).toEqual(fixtureBytes)
  })

  test('a newer Apply supersedes slow preparation without resurrecting its uploaded source or first-use result', async () => {
    // Arrange
    const first = await images.importBackgroundImage(fixture, 1)
    const second = await images.importBackgroundImage(fixture, 1)
    const pause = pausePreparation()
    backgrounds.applyBackground(applicationInput(first.source))
    await pause.entered.promise
    // Act
    backgrounds.applyBackground(applicationInput(second.source))
    pause.release.resolve()
    await waitForApplication('succeeded')
    // Assert
    expect(backgrounds.getBackgroundSnapshot().operation?.operationId).toBe(2)
    expect((await diskSettings()).background.uploads).toHaveLength(1)
    await vi.waitFor(async () =>
      expect(
        await fs.readdir(join(native.userData, 'backgrounds/staging')),
      ).toEqual([]),
    )
    expect(
      await fs.readdir(join(native.userData, 'backgrounds/displays')),
    ).toHaveLength(1)
  })

  test('Clear after the final check waits for atomic Apply and preserves its committed first-use preferences', async () => {
    // Arrange
    const draft = await images.importBackgroundImage(fixture, 1)
    const pause = pauseSettingsRename()
    backgrounds.applyBackground(applicationInput(draft.source))
    await pause.entered.promise
    const prepared = SettingsSchema.parse(
      JSON.parse(
        await fs.readFile(join(native.userData, 'settings.json.tmp'), 'utf8'),
      ),
    )
    const uploadId = prepared.background.uploads[0].id
    // Act
    const clearing = backgrounds.clearBackground()
    expect(
      await fs.readFile(
        join(native.userData, 'backgrounds/uploads', uploadId, 'original'),
      ),
    ).toEqual(fixtureBytes)
    expect(settings.getSettings().background.hasAppliedImage).toBe(false)
    pause.release.resolve()
    await clearing
    // Assert
    const saved = await diskSettings()
    expect(saved.background).toMatchObject({
      selected: null,
      hasAppliedImage: true,
      uploads: [{ id: uploadId }],
    })
    expect(saved.windowBackgroundOpacityPercent).toBe(60)
    expect(
      await fs.readFile(
        join(native.userData, 'backgrounds/uploads', uploadId, 'original'),
      ),
    ).toEqual(fixtureBytes)
    expect(backgrounds.getBackgroundSnapshot().display).toBeNull()
    await vi.waitFor(async () =>
      expect(
        await fs.readdir(join(native.userData, 'backgrounds/displays')),
      ).toEqual([]),
    )
  })

  test('a newer Apply cannot delete the accepted upload while an earlier atomic rename is pending', async () => {
    // Arrange
    const first = await images.importBackgroundImage(fixture, 1)
    const second = await images.importBackgroundImage(fixture, 1)
    const pause = pauseSettingsRename()
    backgrounds.applyBackground(applicationInput(first.source))
    await pause.entered.promise
    const prepared = SettingsSchema.parse(
      JSON.parse(
        await fs.readFile(join(native.userData, 'settings.json.tmp'), 'utf8'),
      ),
    )
    const firstId = prepared.background.uploads[0].id
    // Act
    backgrounds.applyBackground(applicationInput(second.source))
    expect(
      await fs.readFile(
        join(native.userData, 'backgrounds/uploads', firstId, 'original'),
      ),
    ).toEqual(fixtureBytes)
    pause.release.resolve()
    await waitForApplication('succeeded')
    // Assert
    const saved = await diskSettings()
    expect(saved.background.uploads).toHaveLength(2)
    expect(saved.background.uploads[0].id).toBe(firstId)
    expect(
      await fs.readFile(
        join(native.userData, 'backgrounds/uploads', firstId, 'original'),
      ),
    ).toEqual(fixtureBytes)
    expect(saved.windowBackgroundOpacityPercent).toBe(60)
    expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
      operationId: 2,
      opacityAdjusted: false,
    })
  })

  test('removing currently selected A preserves pending B and merges its commit into the latest library', async () => {
    // Arrange
    const selectedId = await addUpload()
    const nextDraft = await images.importBackgroundImage(fixture, 1)
    const pause = pausePreparation()
    backgrounds.applyBackground(applicationInput(nextDraft.source))
    await pause.entered.promise
    // Act
    await backgrounds.removeUploadedBackground(selectedId)
    expect(backgrounds.getBackgroundSnapshot().operation?.status).toBe(
      'applying',
    )
    expect(settings.getSettings().background.selected).toBeNull()
    pause.release.resolve()
    await waitForApplication('succeeded')
    // Assert
    const saved = await diskSettings()
    expect(saved.background.uploads).toHaveLength(1)
    expect(saved.background.uploads[0].id).not.toBe(selectedId)
    expect(saved.background.selected?.source).toEqual({
      kind: 'upload',
      uploadId: saved.background.uploads[0].id,
    })
    await expect(
      fs.access(join(native.userData, 'backgrounds/uploads', selectedId)),
    ).rejects.toThrow()
    expect(await fs.readFile(fixture)).toEqual(fixtureBytes)
  })

  test('removing a pending saved source prevents its delayed recrop from resurrecting the removed library entry', async () => {
    // Arrange
    const uploadId = await addUpload()
    const pause = pausePreparation()
    backgrounds.applyBackground(applicationInput({ kind: 'upload', uploadId }))
    await pause.entered.promise
    // Act
    await backgrounds.removeUploadedBackground(uploadId)
    pause.release.resolve()
    await images.inspectBackgroundImage(fixtureBytes, true)
    // Assert
    expect((await diskSettings()).background).toMatchObject({
      selected: null,
      uploads: [],
      hasAppliedImage: true,
    })
    expect(backgrounds.getBackgroundSnapshot().operation?.status).toBe(
      'superseded',
    )
    await expect(
      fs.access(join(native.userData, 'backgrounds/uploads', uploadId)),
    ).rejects.toThrow()
  })

  test('overlapping preference and layout writes survive an image commit without stale settings replacement', async () => {
    // Arrange
    const draft = await images.importBackgroundImage(fixture, 1)
    const pause = pausePreparation()
    backgrounds.applyBackground(applicationInput(draft.source))
    await pause.entered.promise
    // Act
    await Promise.all([
      settings.saveSettings({
        markdownFontSizePx: 18,
        windowBackgroundOpacityPercent: 90,
      }),
      backgrounds.setBackgroundLayout('fit'),
    ])
    pause.release.resolve()
    await waitForApplication('succeeded')
    // Assert
    const saved = await diskSettings()
    expect(saved).toMatchObject({
      markdownFontSizePx: 18,
      windowBackgroundOpacityPercent: 90,
      background: { layout: 'fit', hasAppliedImage: true },
    })
    expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
      opacityAdjusted: false,
    })
  })

  test('same-source Remove after the final check waits for the accepted recrop before deleting its owned files', async () => {
    // Arrange
    const uploadId = await addUpload()
    const pause = pauseSettingsRename()
    backgrounds.applyBackground(applicationInput({ kind: 'upload', uploadId }))
    await pause.entered.promise
    // Act
    const removing = backgrounds.removeUploadedBackground(uploadId)
    expect(
      await fs.readFile(
        join(native.userData, 'backgrounds/uploads', uploadId, 'original'),
      ),
    ).toEqual(fixtureBytes)
    pause.release.resolve()
    await removing
    // Assert
    expect((await diskSettings()).background).toMatchObject({
      selected: null,
      uploads: [],
      hasAppliedImage: true,
    })
    expect(settings.getSettings().windowBackgroundOpacityPercent).toBe(60)
    await expect(
      fs.access(join(native.userData, 'backgrounds/uploads', uploadId)),
    ).rejects.toThrow()
    await vi.waitFor(async () =>
      expect(
        await fs.readdir(join(native.userData, 'backgrounds/displays')),
      ).toEqual([]),
    )
  })

  test.each(['write', 'rename'])(
    'keeps committed bytes and a failed source/crop/aspect after settings %s failure, then retries the owned original',
    async (failure) => {
      // Arrange
      await settings.saveSettings({ defaultSkillTab: 'info' })
      const previous = await fs.readFile(join(native.userData, 'settings.json'))
      const draft = await images.importBackgroundImage(fixture, 1)
      const input = {
        ...applicationInput(draft.source),
        aspect: '16:10' as const,
      }
      const write = fs.writeFile
      const rename = fs.rename
      if (failure === 'write')
        vi.spyOn(fs, 'writeFile').mockImplementation(async (path, ...args) => {
          if (path === join(native.userData, 'settings.json.tmp'))
            throw new Error('private path: disk full')
          return write(path, ...args)
        })
      else
        vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
          if (to === join(native.userData, 'settings.json'))
            throw new Error('private path: permission denied')
          return rename(from, to)
        })
      // Act
      backgrounds.applyBackground(input)
      await waitForApplication('failed')
      // Assert
      expect(await fs.readFile(join(native.userData, 'settings.json'))).toEqual(
        previous,
      )
      expect(settings.getSettings().background.hasAppliedImage).toBe(false)
      expect(settings.getSettings().windowBackgroundOpacityPercent).toBe(100)
      expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
        status: 'failed',
        source: input.source,
        crop: { x: 0, y: 0, width: 100, height: 100 },
        aspect: '16:10',
        error: { code: 'save-failed' },
      })
      expect(
        JSON.stringify(backgrounds.getBackgroundSnapshot().operation),
      ).not.toContain('private path')
      expect((await backgrounds.previewBackground(draft.source)).width).toBe(
        2400,
      )
      await fs.rm(fixture)
      vi.restoreAllMocks()
      backgrounds.applyBackground({
        ...input,
        requestId: randomUUID(),
        retryOperationId: 1,
      })
      await waitForApplication('succeeded')
      expect((await diskSettings()).background.uploads).toHaveLength(1)
      expect(settings.getSettings().windowBackgroundOpacityPercent).toBe(60)
    },
  )

  test('failed removal preserves the selected reference and owned files and later succeeds without queue poisoning', async () => {
    // Arrange
    const uploadId = await addUpload()
    const before = await fs.readFile(join(native.userData, 'settings.json'))
    const rename = fs.rename
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === join(native.userData, 'settings.json'))
        throw new Error('rename unavailable')
      return rename(from, to)
    })
    // Act / Assert
    await expect(
      backgrounds.removeUploadedBackground(uploadId),
    ).rejects.toThrow('rename unavailable')
    expect(await fs.readFile(join(native.userData, 'settings.json'))).toEqual(
      before,
    )
    expect(
      await fs.readFile(
        join(native.userData, 'backgrounds/uploads', uploadId, 'original'),
      ),
    ).toEqual(fixtureBytes)
    vi.restoreAllMocks()
    await backgrounds.removeUploadedBackground(uploadId)
    expect((await diskSettings()).background.selected).toBeNull()
  })

  test('a failed unlink reports incomplete cleanup while keeping removal durable and the external source intact', async () => {
    // Arrange
    const uploadId = await addUpload()
    const remove = fs.rm
    vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
      if (path === join(native.userData, 'backgrounds/uploads', uploadId))
        throw new Error('unlink denied')
      return remove(path, options)
    })
    // Act
    await expect(
      backgrounds.removeUploadedBackground(uploadId),
    ).rejects.toThrow(
      'removed from the gallery, but its local copy could not be deleted',
    )
    // Assert
    expect((await diskSettings()).background).toMatchObject({
      selected: null,
      uploads: [],
    })
    expect(await fs.readFile(fixture)).toEqual(fixtureBytes)
    expect(
      await fs.readFile(
        join(native.userData, 'backgrounds/uploads', uploadId, 'original'),
      ),
    ).toEqual(fixtureBytes)
  })

  test('unchanged nested background settings, layout and unknown removal perform no write or broadcast', async () => {
    // Arrange
    await addUpload()
    const write = vi.spyOn(fs, 'writeFile')
    const broadcasts = native.mainSend.mock.calls.length
    // Act
    await settings.saveSettings({ defaultSkillTab: 'files' })
    await backgrounds.setBackgroundLayout('fill')
    await backgrounds.removeUploadedBackground(randomUUID())
    // Assert
    expect(write).not.toHaveBeenCalled()
    expect(native.mainSend.mock.calls).toHaveLength(broadcasts)
  })

  test('restores the accepted local crop without an Apply or provider request and only explicit display Retry advances reload generation', async () => {
    // Arrange
    await addUpload()
    const selected = settings.getSettings().background.selected
    const write = vi.spyOn(fs, 'writeFile')
    const fetch = vi.spyOn(globalThis, 'fetch')
    // Act
    await backgrounds.initializeBackgrounds()
    await backgrounds.setBackgroundLayout('fit')
    const beforeRetry = backgrounds.getBackgroundSnapshot()
    await backgrounds.retryBackgroundDisplay()
    // Assert
    expect(beforeRetry.displayRetryRevision).toBe(0)
    expect(backgrounds.getBackgroundSnapshot().displayRetryRevision).toBe(1)
    expect(backgrounds.getBackgroundSnapshot().display?.selection).toEqual(
      selected,
    )
    expect(backgrounds.getBackgroundSnapshot().operation?.operationId).toBe(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
    expect(native.settingsSend).toHaveBeenLastCalledWith(
      'backgrounds:changed',
      backgrounds.getBackgroundSnapshot(),
    )
  })

  test('a missing display falls back without forgetting its selected source, and Retry recovers the repaired file', async () => {
    // Arrange
    await addUpload()
    const selection = settings.getSettings().background.selected
    const path = join(
      native.userData,
      'backgrounds/displays',
      `${selection?.displayId}.webp`,
    )
    const bytes = await fs.readFile(path)
    await fs.rm(path)
    // Act
    await backgrounds.initializeBackgrounds()
    // Assert
    expect(backgrounds.getBackgroundSnapshot().display).toBeNull()
    expect((await diskSettings()).background.selected).toEqual(selection)
    await fs.writeFile(path, bytes)
    await backgrounds.retryBackgroundDisplay()
    expect(backgrounds.getBackgroundSnapshot().display?.selection).toEqual(
      selection,
    )
  })

  test('a corrupt settings file never authorizes cleanup of existing app-owned image directories', async () => {
    // Arrange
    const uploadId = await addUpload()
    await fs.writeFile(join(native.userData, 'settings.json'), '{broken')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Act
    await settings.loadSettings()
    await backgrounds.initializeBackgrounds()
    await backgrounds.clearBackground()
    // Assert
    expect(settings.getSettings()).toEqual(DEFAULT_SETTINGS)
    expect(backgrounds.getBackgroundSnapshot().display).toBeNull()
    expect(
      await fs.readFile(
        join(native.userData, 'backgrounds/uploads', uploadId, 'original'),
      ),
    ).toEqual(fixtureBytes)
  })

  test('Main rejects an undersized crop of a valid source without overwriting the previous display', async () => {
    // Arrange
    const uploadId = await addUpload()
    const selected = settings.getSettings().background.selected
    // Act
    backgrounds.applyBackground({
      ...applicationInput({ kind: 'upload', uploadId }),
      crop: { x: 0, y: 0, width: 50, height: 50 },
    })
    await waitForApplication('failed')
    // Assert
    expect((await diskSettings()).background.selected).toEqual(selected)
    expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
      status: 'failed',
      error: { code: 'invalid-crop' },
    })
    expect(backgrounds.getBackgroundSnapshot().display?.selection).toEqual(
      selected,
    )
  })
})
