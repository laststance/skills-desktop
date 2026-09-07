import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { z } from 'zod'

import { BackgroundApplySourceSchema } from '@/shared/backgrounds'

import type * as ImagesModule from '../services/backgroundImages'
import type * as BackgroundsModule from '../services/backgrounds'
import type * as SettingsModule from '../services/settings'

const native = vi.hoisted(() => ({
  userData: '',
  handles: new Map<
    string,
    (event: unknown, ...args: unknown[]) => Promise<unknown>
  >(),
  picker: vi.fn<() => Promise<{ canceled: boolean; filePaths: string[] }>>(),
  windows: new Map<
    number,
    {
      isDestroyed: () => boolean
      webContents: {
        id: number
        isDestroyed: () => boolean
        send: (channel: string, payload: unknown) => void
      }
    }
  >(),
}))
vi.mock('electron', () => ({
  app: {
    getPath: () => native.userData,
    getAppPath: () => join(process.cwd(), 'out', 'main'),
    isPackaged: false,
  },
  ipcMain: {
    handle: (
      channel: string,
      callback: (event: unknown, ...args: unknown[]) => Promise<unknown>,
    ) => native.handles.set(channel, callback),
  },
  dialog: { showOpenDialog: async () => native.picker() },
  BrowserWindow: {
    getAllWindows: () => [...native.windows.values()],
    fromWebContents: (owner: { id: number }) => native.windows.get(owner.id),
  },
}))

/** Models only the native events/transport boundary while the IPC validation, file services and save queue stay real.
 * @returns A closable sender that records both-window broadcasts.
 * @example const owner = new BackgroundTestSender(1); owner.destroy()
 */
class BackgroundTestSender extends EventEmitter {
  destroyed = false
  send = vi.fn<(channel: string, payload: unknown) => void>()
  constructor(readonly id: number) {
    super()
  }
  /** Reports native teardown for existing typed broadcasts and picker ownership checks.
   * @returns Whether this simulated window closed.
   * @example owner.isDestroyed() // false before destroy()
   */
  isDestroyed(): boolean {
    return this.destroyed
  }
  /** Emits the actual lifecycle event used by Main's draft cleanup listener.
   * @returns Nothing; Main must preserve any already accepted input.
   * @example owner.destroy()
   */
  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }
}

let owner: BackgroundTestSender
let main: BackgroundTestSender
let directory: string
let fixture: string
let images: typeof ImagesModule
let backgrounds: typeof BackgroundsModule
let settings: typeof SettingsModule

/** Calls the registered typed IPC wrapper so tuple validation and synchronous acceptance both run unchanged.
 * @returns The production handler's serialized-shaped result.
 * @example await invoke('backgrounds:list')
 */
async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const handle = native.handles.get(channel)
  if (!handle) throw new Error(`Missing handler ${channel}`)
  return handle({ sender: owner }, ...args)
}

beforeEach(async () => {
  vi.resetModules()
  native.handles.clear()
  native.windows.clear()
  native.picker.mockReset()
  directory = await fs.mkdtemp(join(tmpdir(), 'skills-background-ipc-'))
  native.userData = join(directory, 'profile')
  fixture = join(directory, 'external.jpg')
  await sharp({
    create: { width: 1920, height: 1080, channels: 3, background: '#345678' },
  })
    .jpeg()
    .toFile(fixture)
  native.picker.mockResolvedValue({ canceled: false, filePaths: [fixture] })
  owner = new BackgroundTestSender(11)
  main = new BackgroundTestSender(12)
  native.windows.set(owner.id, {
    isDestroyed: () => owner.isDestroyed(),
    webContents: owner,
  })
  native.windows.set(main.id, {
    isDestroyed: () => main.isDestroyed(),
    webContents: main,
  })
  settings = await import('../services/settings')
  images = await import('../services/backgroundImages')
  backgrounds = await import('../services/backgrounds')
  await settings.loadSettings()
  const { registerBackgroundHandlers } = await import('./backgrounds')
  registerBackgroundHandlers()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await backgrounds.clearBackground()
  await images.discardBackgroundDraftsForOwner(owner.id)
  await fs.rm(directory, { recursive: true, force: true })
})

describe('gallery IPC and native picker ownership', () => {
  test('unexpected native failures retain a safe diagnostic in Main and expose only actionable recovery guidance', async () => {
    // Arrange
    const diagnostic = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    native.picker.mockRejectedValue(
      new TypeError(`Native failure at ${fixture}`),
    )
    // Act / Assert
    await expect(invoke('backgrounds:importImage')).rejects.toThrow(
      'The background could not be updated. Check available disk space and permissions, then try again.',
    )
    expect(diagnostic.mock.calls).toEqual([
      ['[backgrounds] unexpected IPC failure', 'TypeError'],
    ])
    expect(settings.getSettings().background.uploads).toEqual([])
  })
  test('synchronous Apply rejection keeps an expired draft readable and hides unexpected native details', async () => {
    // Arrange
    const diagnostic = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const input = {
      requestId: randomUUID(),
      source: { kind: 'upload-draft', draftId: randomUUID() },
      crop: { x: 0, y: 0, width: 100, height: 100 },
      aspect: 'original',
    }
    // Act / Assert
    await expect(invoke('backgrounds:apply', input)).rejects.toThrow(
      'This upload draft has expired. Choose the image again.',
    )
    expect(diagnostic).not.toHaveBeenCalled()
    vi.spyOn(images, 'claimBackgroundDraft').mockImplementationOnce(() => {
      throw new TypeError(`Private failure at ${fixture}`)
    })
    await expect(
      invoke('backgrounds:apply', { ...input, requestId: randomUUID() }),
    ).rejects.toThrow(
      'The background could not be updated. Check available disk space and permissions, then try again.',
    )
    expect(diagnostic.mock.calls).toEqual([
      ['[backgrounds] unexpected IPC failure', 'TypeError'],
    ])
    expect(settings.getSettings().background.uploads).toEqual([])
    expect(backgrounds.getBackgroundSnapshot().operation).toBeNull()
  })

  test('picker cancellation returns no draft and never creates an owned image directory', async () => {
    // Arrange
    native.picker.mockResolvedValue({ canceled: true, filePaths: [] })
    // Act
    const imported = await invoke('backgrounds:importImage')
    // Assert
    expect(imported).toBeNull()
    expect(settings.getSettings().background.uploads).toEqual([])
    await expect(
      fs.access(join(native.userData, 'backgrounds')),
    ).rejects.toThrow()
  })

  test('import exposes a validated opaque draft and bounded preview while keeping the native path private', async () => {
    // Arrange / Act
    const imported = await invoke('backgrounds:importImage')
    // Assert
    expect(imported).toMatchObject({
      source: { kind: 'upload-draft' },
      width: 1920,
      height: 1080,
      credit: null,
    })
    expect(JSON.stringify(imported)).not.toContain(fixture)
    expect(JSON.stringify(imported)).not.toContain(native.userData)
    expect(settings.getSettings().background.uploads).toEqual([])
    expect(
      await fs.readdir(join(native.userData, 'backgrounds/staging')),
    ).toHaveLength(1)
  })

  test('closing Settings after import removes its unclaimed draft without deleting the user original', async () => {
    // Arrange
    await invoke('backgrounds:importImage')
    // Act
    owner.destroy()
    // Assert
    await vi.waitFor(async () =>
      expect(
        await fs.readdir(join(native.userData, 'backgrounds/staging')),
      ).toEqual([]),
    )
    expect((await fs.stat(fixture)).isFile()).toBe(true)
  })

  test('closing Settings while the picker is open cannot import its eventual native selection', async () => {
    // Arrange
    let select = () => {}
    const selection = new Promise<void>((resolve) => {
      select = resolve
    })
    native.picker.mockImplementation(async () => {
      await selection
      return { canceled: false, filePaths: [fixture] }
    })
    // Act
    const importing = invoke('backgrounds:importImage')
    owner.destroy()
    select()
    // Assert
    expect(await importing).toBeNull()
    await expect(
      fs.access(join(native.userData, 'backgrounds')),
    ).rejects.toThrow()
  })

  test('Apply claims its input before a delayed IPC reply and survives both windows closing immediately', async () => {
    // Arrange
    const imported = z
      .object({ source: BackgroundApplySourceSchema })
      .parse(await invoke('backgrounds:importImage'))
    const requestId = randomUUID()
    // Act
    const delayedReply = invoke('backgrounds:apply', {
      requestId,
      source: imported.source,
      crop: { x: 0, y: 0, width: 100, height: 100 },
      aspect: 'original',
    })
    owner.destroy()
    main.destroy()
    // Assert
    expect(await delayedReply).toEqual({ operationId: 1, requestId })
    await vi.waitFor(() =>
      expect(backgrounds.getBackgroundSnapshot().operation?.status).toBe(
        'succeeded',
      ),
    )
    expect(settings.getSettings().background.uploads).toHaveLength(1)
    const uploadId = settings.getSettings().background.uploads[0].id
    expect(
      await fs.readFile(
        join(native.userData, 'backgrounds/uploads', uploadId, 'original'),
      ),
    ).toEqual(await fs.readFile(fixture))
  })

  test('both windows receive a retained failed crop result and a reopened Settings sender can read its owned preview', async () => {
    // Arrange
    const imported = z
      .object({ source: BackgroundApplySourceSchema })
      .parse(await invoke('backgrounds:importImage'))
    const rename = fs.rename
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === join(native.userData, 'settings.json'))
        throw new Error('private file failure')
      return rename(from, to)
    })
    // Act
    await invoke('backgrounds:apply', {
      requestId: randomUUID(),
      source: imported.source,
      crop: { x: 0, y: 0, width: 100, height: 100 },
      aspect: '16:9',
    })
    await vi.waitFor(() =>
      expect(backgrounds.getBackgroundSnapshot().operation?.status).toBe(
        'failed',
      ),
    )
    const failed = backgrounds.getBackgroundSnapshot()
    owner.destroy()
    owner = new BackgroundTestSender(13)
    native.windows.set(owner.id, {
      isDestroyed: () => owner.isDestroyed(),
      webContents: owner,
    })
    // Assert
    expect(main.send).toHaveBeenCalledWith('backgrounds:changed', failed)
    expect(await invoke('backgrounds:getSnapshot')).toMatchObject({
      operation: {
        status: 'failed',
        source: imported.source,
        aspect: '16:9',
        error: { code: 'save-failed' },
      },
    })
    expect(await invoke('backgrounds:preview', imported.source)).toMatchObject({
      width: 1920,
      height: 1080,
    })
    expect(JSON.stringify(failed)).not.toContain('private file failure')
  })

  test('explicit Retry has its own broadcast generation and performs no settings write or new application', async () => {
    // Arrange
    const write = vi.spyOn(fs, 'writeFile')
    // Act
    const retry = await invoke('backgrounds:retryDisplay')
    // Assert
    expect(retry).toEqual({
      revision: 1,
      displayRetryRevision: 1,
      operation: null,
      display: null,
    })
    expect(write).not.toHaveBeenCalled()
    expect(main.send).toHaveBeenCalledWith('backgrounds:changed', retry)
    expect(owner.send).toHaveBeenCalledWith('backgrounds:changed', retry)
  })

  test.each([
    ['backgrounds:importImage', ['/private/source.jpg']],
    ['backgrounds:discardDraft', [{ draftId: '../../private' }]],
    ['backgrounds:preview', [{ kind: 'upload', uploadId: '../../private' }]],
    ['backgrounds:removeUpload', [{ uploadId: '../../private' }]],
    ['backgrounds:setLayout', ['stretch']],
    ['backgrounds:retryDisplay', ['unexpected']],
  ])(
    'strict %s IPC rejects path-bearing or unknown arguments before native file access',
    async (channel, args) => {
      // Arrange / Act / Assert
      await expect(invoke(channel, ...args)).rejects.toThrow(
        'IPC validation failed',
      )
      expect(native.picker).not.toHaveBeenCalled()
      await expect(
        fs.access(join(native.userData, 'backgrounds')),
      ).rejects.toThrow()
    },
  )

  test('ordinary picker failures produce a safe Settings error without exposing the selected path', async () => {
    // Arrange
    native.picker.mockRejectedValue(new Error(`Cannot access ${fixture}`))
    // Act / Assert
    await expect(invoke('backgrounds:importImage')).rejects.toThrow(
      'Check available disk space and permissions',
    )
    expect(settings.getSettings().background.selected).toBeNull()
  })

  test('Remove broadcasts durable reference removal and surfaces partial file cleanup failure through the real IPC error path', async () => {
    // Arrange
    const draft = await images.importBackgroundImage(fixture, owner.id)
    backgrounds.applyBackground({
      requestId: randomUUID(),
      source: draft.source,
      crop: { x: 0, y: 0, width: 100, height: 100 },
      aspect: 'original',
    })
    await vi.waitFor(() =>
      expect(backgrounds.getBackgroundSnapshot().operation?.status).toBe(
        'succeeded',
      ),
    )
    const uploadId = settings.getSettings().background.uploads[0].id
    const remove = fs.rm
    vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
      if (path === join(native.userData, 'backgrounds/uploads', uploadId))
        throw new Error(`Cannot unlink ${path}`)
      return remove(path, options)
    })
    // Act / Assert
    await expect(
      invoke('backgrounds:removeUpload', { uploadId }),
    ).rejects.toThrow(
      'The image was removed from the gallery, but its local copy could not be deleted. Check disk permissions.',
    )
    expect(settings.getSettings().background).toMatchObject({
      selected: null,
      uploads: [],
    })
    expect(main.send).toHaveBeenCalledWith('settings:changed', {
      settings: settings.getSettings(),
    })
    expect(owner.send).toHaveBeenCalledWith('settings:changed', {
      settings: settings.getSettings(),
    })
    expect(
      await fs.readFile(
        join(native.userData, 'backgrounds/uploads', uploadId, 'original'),
      ),
    ).toEqual(await fs.readFile(fixture))
  })
})
