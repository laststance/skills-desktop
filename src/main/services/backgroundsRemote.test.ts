import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ORPCError } from '@orpc/client'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { type BackgroundApplyInput } from '@/shared/backgrounds'
import { SettingsSchema } from '@/shared/settings'

import type { UnsplashPhoto } from '../../../website/src/lib/unsplash-contract'

import type * as BackgroundsModule from './backgrounds'
import type * as RemoteModule from './backgroundsRemote'
import type * as SettingsModule from './settings'

const native = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => native.userData, getAppPath: () => process.cwd() },
  BrowserWindow: { getAllWindows: () => [] },
}))

const photo: UnsplashPhoto = {
  id: 'background-fixture',
  width: 2400,
  height: 1600,
  description: null,
  altDescription: 'A blue pixel fixture',
  urls: {
    raw: 'https://images.unsplash.com/photo-background-fixture?ixid=tracking-value&ixlib=rb-4.1.0&w=300&crop=faces&rect=1,1,2,2',
    small:
      'https://images.unsplash.com/photo-background-fixture?ixid=tracking-value&w=400',
  },
  links: {
    html: 'https://unsplash.com/photos/background-fixture',
    downloadLocation:
      'https://api.unsplash.com/photos/background-fixture/download?ixid=tracking-value',
  },
  photographer: {
    name: 'Fixture Photographer',
    username: 'fixture',
    profileUrl: 'https://unsplash.com/@fixture',
  },
}
const fetchResponse = vi.fn<typeof fetch>()
let backgrounds: typeof BackgroundsModule
let remote: typeof RemoteModule
let settings: typeof SettingsModule
let directory: string
let imageBytes: Buffer

/** Creates a new online user intent with valid provider metadata and source-relative crop coordinates.
 * @returns A full-resolution application request.
 * @example onlineInput().source.kind // 'unsplash'
 */
function onlineInput(): BackgroundApplyInput {
  return {
    requestId: randomUUID(),
    source: { kind: 'unsplash', photo },
    crop: { x: 0, y: 0, width: 100, height: 100 },
    aspect: 'original',
  }
}

/** Supplies actual encoded pixels or the stable oRPC success envelope at the HTTP boundary.
 * @returns A fresh response; the production client still serializes and decodes its request/result.
 * @example responseFor(request)
 */
function responseFor(request: RequestInfo | URL): Response {
  return request instanceof Request
    ? Response.json({ json: { acknowledged: true } })
    : new Response(new Uint8Array(imageBytes), {
        headers: { 'content-type': 'image/jpeg' },
      })
}

/** Waits for the observable operation result after real decoding and real settings writes.
 * @returns Completion after Main publishes the requested terminal status.
 * @example await resultStatus('failed')
 */
async function resultStatus(status: 'succeeded' | 'failed'): Promise<void> {
  await vi.waitFor(
    () =>
      expect(backgrounds.getBackgroundSnapshot().operation?.status).toBe(
        status,
      ),
    { timeout: 5000 },
  )
}

beforeEach(async () => {
  vi.resetModules()
  directory = await fs.mkdtemp(join(tmpdir(), 'skills-background-online-'))
  native.userData = join(directory, 'profile')
  imageBytes = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: '#21568c' },
  })
    .jpeg()
    .toBuffer()
  fetchResponse
    .mockReset()
    .mockImplementation(async (request) => responseFor(request))
  vi.stubGlobal('fetch', fetchResponse)
  settings = await import('./settings')
  remote = await import('./backgroundsRemote')
  backgrounds = await import('./backgrounds')
  await settings.loadSettings()
})

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await backgrounds.clearBackground()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('online background preparation and provider acknowledgement', () => {
  test('validates actual full-resolution pixels and sends one typed notification while keeping the displayed image hotlinked', async () => {
    // Arrange
    const input = onlineInput()
    // Act
    backgrounds.applyBackground(input)
    await resultStatus('succeeded')
    // Assert
    expect(fetchResponse).toHaveBeenCalledTimes(2)
    expect(fetchResponse.mock.calls[0][0]).toBe(
      'https://images.unsplash.com/photo-background-fixture?ixid=tracking-value&fm=jpg&q=88',
    )
    expect(fetchResponse.mock.calls[0][1]?.redirect).toBe('error')
    const request = fetchResponse.mock.calls[1][0]
    expect(request).toBeInstanceOf(Request)
    if (!(request instanceof Request))
      throw new Error('Expected the real oRPC request')
    expect(request.url).toBe(
      'https://skills-desktop.vercel.app/api/rpc/unsplash/trackDownload',
    )
    expect(await request.json()).toEqual({
      json: {
        photoId: 'background-fixture',
        downloadLocation:
          'https://api.unsplash.com/photos/background-fixture/download?ixid=tracking-value',
      },
    })
    expect(backgrounds.getBackgroundSnapshot().display).toMatchObject({
      image: {
        url: 'https://images.unsplash.com/photo-background-fixture?ixid=tracking-value&fm=jpg&q=88',
        width: 2400,
        height: 1600,
      },
      crop: { x: 0, y: 0, width: 100, height: 100 },
      credit: {
        photographerName: 'Fixture Photographer',
        photographerUrl:
          'https://unsplash.com/@fixture?utm_source=skills-desktop&utm_medium=referral',
        photoUrl:
          'https://unsplash.com/photos/background-fixture?utm_source=skills-desktop&utm_medium=referral',
      },
    })
    const saved = SettingsSchema.parse(
      JSON.parse(
        await fs.readFile(join(native.userData, 'settings.json'), 'utf8'),
      ),
    )
    expect(saved.background.selected).toMatchObject({ source: input.source })
    expect(saved.background.selected?.displayId).toBeUndefined()
    await expect(
      fs.access(join(native.userData, 'backgrounds')),
    ).rejects.toThrow()
  })

  test('same-photo recropping and restoration never repeat download notifications or create a permanent image cache', async () => {
    // Arrange
    backgrounds.applyBackground(onlineInput())
    await resultStatus('succeeded')
    fetchResponse.mockClear()
    // Act
    backgrounds.applyBackground({
      ...onlineInput(),
      crop: { x: 0, y: 0, width: 80, height: 80 },
      aspect: '16:10',
    })
    await resultStatus('succeeded')
    await backgrounds.initializeBackgrounds()
    await backgrounds.retryBackgroundDisplay()
    // Assert
    expect(fetchResponse).toHaveBeenCalledTimes(1)
    expect(fetchResponse.mock.calls[0][0]).toBe(
      'https://images.unsplash.com/photo-background-fixture?ixid=tracking-value&fm=jpg&q=88',
    )
    expect(backgrounds.getBackgroundSnapshot().display?.crop).toEqual({
      x: 0,
      y: 0,
      width: 80,
      height: 80,
    })
    expect(backgrounds.getBackgroundSnapshot().displayRetryRevision).toBe(1)
    await expect(
      fs.access(join(native.userData, 'backgrounds')),
    ).rejects.toThrow()
  })

  test('a failed disk save retains the acknowledged notification for an exact retry but rejects changed crop inputs', async () => {
    // Arrange
    const input = onlineInput()
    const rename = fs.rename
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === join(native.userData, 'settings.json'))
        throw new Error('disk denied')
      return rename(from, to)
    })
    // Act
    backgrounds.applyBackground(input)
    await resultStatus('failed')
    // Assert
    expect(fetchResponse).toHaveBeenCalledTimes(2)
    expect(settings.getSettings().background.hasAppliedImage).toBe(false)
    expect(() =>
      backgrounds.applyBackground({
        ...input,
        requestId: randomUUID(),
        retryOperationId: 1,
        crop: { x: 0, y: 0, width: 90, height: 90 },
      }),
    ).toThrow('no longer current')
    vi.restoreAllMocks()
    backgrounds.applyBackground({
      ...input,
      requestId: randomUUID(),
      retryOperationId: 1,
    })
    await resultStatus('succeeded')
    expect(fetchResponse).toHaveBeenCalledTimes(3)
    expect(
      fetchResponse.mock.calls.filter(
        ([request]) => request instanceof Request,
      ),
    ).toHaveLength(1)
    expect(settings.getSettings().background.hasAppliedImage).toBe(true)
  })

  test('Clear before a slow image response prevents its later provider side effect and first-use commit', async () => {
    // Arrange
    let release = () => {}
    const responseReady = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchResponse.mockImplementationOnce(async () => {
      await responseReady
      return new Response(new Uint8Array(imageBytes))
    })
    // Act
    backgrounds.applyBackground(onlineInput())
    await vi.waitFor(() => expect(fetchResponse).toHaveBeenCalledTimes(1))
    await backgrounds.clearBackground()
    release()
    await vi.waitFor(() =>
      expect(backgrounds.getBackgroundSnapshot().operation?.status).toBe(
        'superseded',
      ),
    )
    // Give the actual decoder a barrier before checking absence of the provider call.
    const images = await import('./backgroundImages')
    await images.inspectBackgroundImage(imageBytes, true)
    // Assert
    expect(fetchResponse).toHaveBeenCalledTimes(1)
    expect(settings.getSettings().background.hasAppliedImage).toBe(false)
    expect(settings.getSettings().windowBackgroundOpacityPercent).toBe(100)
  })

  test('Clear during a notification response rejects the later final commit without pretending the remote side effect was undone', async () => {
    // Arrange
    let release = () => {}
    const acknowledged = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchResponse.mockImplementation(async (request) => {
      if (request instanceof Request) await acknowledged
      return responseFor(request)
    })
    // Act
    backgrounds.applyBackground(onlineInput())
    await vi.waitFor(() => expect(fetchResponse).toHaveBeenCalledTimes(2))
    await backgrounds.clearBackground()
    release()
    // Assert
    expect(settings.getSettings().background.hasAppliedImage).toBe(false)
    expect(backgrounds.getBackgroundSnapshot().operation?.status).toBe(
      'superseded',
    )
    expect(fetchResponse).toHaveBeenCalledTimes(2)
  })

  test('a CDN response smaller than the declared source fails actual-pixel validation before notification', async () => {
    // Arrange
    const smallBytes = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: '#124578' },
    })
      .jpeg()
      .toBuffer()
    fetchResponse.mockResolvedValue(new Response(new Uint8Array(smallBytes)))
    // Act
    backgrounds.applyBackground(onlineInput())
    await resultStatus('failed')
    // Assert
    expect(fetchResponse).toHaveBeenCalledTimes(1)
    expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
      error: { code: 'invalid-image' },
    })
    expect(settings.getSettings().background.selected).toBeNull()
  })

  test('preview reports actual bounded dimensions separately from original crop coordinates and sends no notification', async () => {
    // Arrange
    const previewBytes = await sharp(imageBytes)
      .resize({ width: 1920 })
      .jpeg()
      .toBuffer()
    fetchResponse.mockResolvedValue(new Response(new Uint8Array(previewBytes)))
    // Act
    const preview = await remote.previewOnlineBackground(photo)
    // Assert
    expect([preview.width, preview.height]).toEqual([2400, 1600])
    expect([preview.image.width, preview.image.height]).toEqual([1920, 1280])
    expect(preview.image.url).toBe(
      'https://images.unsplash.com/photo-background-fixture?ixid=tracking-value&fm=jpg&q=88&w=1920&h=1920&fit=max',
    )
    expect(fetchResponse).toHaveBeenCalledTimes(1)
    expect(settings.getSettings().background.selected).toBeNull()
  })

  test.each(['declared', 'streamed'])(
    'rejects an oversized %s image response before decode and leaves the first-use settings intact',
    async (boundary) => {
      // Arrange
      const response =
        boundary === 'declared'
          ? new Response(new Uint8Array(imageBytes), {
              headers: { 'content-length': '20971521' },
            })
          : new Response(new Uint8Array(20 * 1024 * 1024 + 1), {
              headers: { 'content-length': '1' },
            })
      fetchResponse.mockResolvedValue(response)
      // Act
      backgrounds.applyBackground(onlineInput())
      await resultStatus('failed')
      // Assert
      expect(fetchResponse).toHaveBeenCalledTimes(1)
      expect(settings.getSettings().background.hasAppliedImage).toBe(false)
      expect(settings.getSettings().windowBackgroundOpacityPercent).toBe(100)
      expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
        error: { code: 'provider-unavailable' },
      })
    },
  )

  test('forbids arbitrary image origins before any HTTP request or Apply acceptance', () => {
    // Arrange
    const input = {
      ...onlineInput(),
      source: {
        kind: 'unsplash' as const,
        photo: {
          ...photo,
          urls: {
            ...photo.urls,
            raw: 'https://example.com/private?ixid=value',
          },
        },
      },
    }
    // Act / Assert
    expect(() => backgrounds.applyBackground(input)).toThrow()
    expect(fetchResponse).not.toHaveBeenCalled()
    expect(backgrounds.getBackgroundSnapshot().operation).toBeNull()
  })

  test.each([
    {
      provider: 'RATE_LIMITED',
      status: 429,
      error: 'rate-limited',
      data: { retryAfterSeconds: 45 },
    },
    {
      provider: 'UNAVAILABLE',
      status: 503,
      error: 'provider-unavailable',
      data: undefined,
    },
    {
      provider: 'NOTIFICATION_UNCERTAIN',
      status: 504,
      error: 'notification-uncertain',
      data: undefined,
    },
  ])(
    'preserves the current image and reports $error without automatically retrying a typed $provider result',
    async ({ provider, status, error, data }) => {
      // Arrange
      const providerError = new ORPCError(provider, {
        status,
        defined: true,
        data,
        message: 'private provider response',
      })
      fetchResponse.mockImplementation(async (request) =>
        request instanceof Request
          ? Response.json({ json: providerError.toJSON() }, { status })
          : responseFor(request),
      )
      // Act
      backgrounds.applyBackground(onlineInput())
      await resultStatus('failed')
      // Assert
      expect(fetchResponse).toHaveBeenCalledTimes(2)
      expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
        status: 'failed',
        error: { code: error },
      })
      if (provider === 'RATE_LIMITED')
        expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
          error: { retryAfterSeconds: 45 },
        })
      expect(
        JSON.stringify(backgrounds.getBackgroundSnapshot().operation),
      ).not.toContain('private provider response')
      expect(settings.getSettings().background.selected).toBeNull()
    },
  )

  test('an oversized notification reply stays uncertain and never retries the side effect automatically', async () => {
    // Arrange
    fetchResponse.mockImplementation(async (request) =>
      request instanceof Request
        ? new Response('x'.repeat(65537))
        : responseFor(request),
    )
    // Act
    backgrounds.applyBackground(onlineInput())
    await resultStatus('failed')
    // Assert
    expect(fetchResponse).toHaveBeenCalledTimes(2)
    expect(backgrounds.getBackgroundSnapshot().operation).toMatchObject({
      error: { code: 'notification-uncertain' },
    })
    expect(settings.getSettings().background.hasAppliedImage).toBe(false)
  })

  test('the notification deadline cancels a hanging request and reports delivery uncertainty without an automatic retry', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetchResponse.mockImplementation(
      async (_request, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new Error('request aborted')),
            { once: true },
          )
        }),
    )
    // Act
    const failure = expect(
      remote.notifyBackgroundDownload(photo),
    ).rejects.toMatchObject({ detail: { code: 'notification-uncertain' } })
    await vi.advanceTimersByTimeAsync(15_000)
    await failure
    // Assert
    expect(fetchResponse).toHaveBeenCalledTimes(1)
  })
})
