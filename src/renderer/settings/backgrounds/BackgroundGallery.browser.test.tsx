import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { z } from 'zod'

import { AppToaster } from '@/renderer/src/components/AppToaster'
import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import settingsReducer, {
  setSettings,
} from '@/renderer/src/redux/slices/settingsSlice'
import themeReducer from '@/renderer/src/redux/slices/themeSlice'
import '@/renderer/src/styles/globals.css'
import {
  DEFAULT_BACKGROUND_CROP,
  type BackgroundApplyInput,
  type BackgroundCatalogItem,
  type BackgroundPreview,
  type BackgroundSnapshot,
} from '@/shared/backgrounds'
import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'

import {
  UnsplashSearchInputSchema,
  type UnsplashPhoto,
} from '../../../../website/src/lib/unsplash-contract'
import { Appearance } from '../sections/Appearance'

import { backgroundQueryClient } from './query'

const previewUrl = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160"><rect width="3840" height="2160" fill="#305b58"/><rect width="1920" height="2160" fill="#527c69"/></svg>')}`
const lake: BackgroundCatalogItem = {
  source: { kind: 'builtin', builtinId: 'alpine-lake' },
  title: 'Alpine lake',
  width: 3840,
  height: 2160,
  thumbnail: { url: previewUrl, width: 3840, height: 2160 },
  credit: {
    photographerName: 'Mike Petrucci',
    photographerUrl: 'https://unsplash.com/@mikepetrucci',
    photoUrl: 'https://unsplash.com/photos/5oRIcisKaxU',
  },
}
const forest: BackgroundCatalogItem = {
  ...lake,
  source: { kind: 'builtin', builtinId: 'misty-forest' },
  title: 'Misty forest',
}
let broadcast: (snapshot: BackgroundSnapshot) => void = () => undefined
const apply =
  vi.fn<
    (
      input: BackgroundApplyInput,
    ) => Promise<{ operationId: number; requestId: string }>
  >()
const discard = vi.fn()
const importImage = vi.fn()
const fetchBoundary = vi.fn<typeof fetch>()
const nativeFetch = globalThis.fetch.bind(globalThis)
let currentSnapshot: BackgroundSnapshot
let cleanupScreen: (() => void | Promise<void>) | undefined

beforeEach(async () => {
  await page.viewport(800, 600)
  backgroundQueryClient.clear()
  currentSnapshot = {
    revision: 0,
    displayRetryRevision: 0,
    operation: null,
    display: null,
  }
  apply.mockReset().mockImplementation(async (input) => ({
    operationId: 1,
    requestId: input.requestId,
  }))
  discard.mockReset().mockResolvedValue(undefined)
  importImage.mockReset().mockResolvedValue(null)
  fetchBoundary
    .mockReset()
    .mockResolvedValue(Response.json({ json: { items: [], nextPage: null } }))
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input)
      return url.includes('/api/rpc/')
        ? fetchBoundary(input, init)
        : nativeFetch(input, init)
    },
  )
  vi.stubGlobal('electron', {
    settings: { set: async () => DEFAULT_SETTINGS },
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
    backgrounds: {
      list: async () => ({ builtins: [lake, forest], uploads: [] }),
      getSnapshot: async () => currentSnapshot,
      onChanged: (callback: typeof broadcast) => {
        broadcast = callback
        return () => {
          broadcast = () => undefined
        }
      },
      preview: async (
        source: BackgroundPreview['source'],
      ): Promise<BackgroundPreview> => ({
        source,
        title:
          source.kind === 'builtin' && source.builtinId === 'misty-forest'
            ? 'Misty forest'
            : 'Alpine lake',
        width: 3840,
        height: 2160,
        image: { url: previewUrl, width: 3840, height: 2160 },
        credit: lake.credit,
      }),
      importImage,
      discardDraft: discard,
      apply,
      clear: async () => DEFAULT_SETTINGS,
      setLayout: async () => DEFAULT_SETTINGS,
      removeUpload: async () => DEFAULT_SETTINGS,
    },
  })
})
afterEach(async () => {
  const dispose = cleanupScreen
  cleanupScreen = undefined
  await dispose?.()
  toast.dismiss()
  vi.unstubAllGlobals()
  backgroundQueryClient.clear()
})

/** Mounts the real Appearance/Redux/Toaster chain; only IPC and HTTP transport are replaced.
 * @returns Screen and canonical store for observable state assertions.
 * @example const { screen, store } = await renderGallery()
 */
async function renderGallery(overrides: Partial<Settings> = {}) {
  const store = configureStore({
    reducer: { settings: settingsReducer, theme: themeReducer },
    preloadedState: { settings: { ...DEFAULT_SETTINGS, ...overrides } },
  })
  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <Appearance />
        <AppToaster />
      </TooltipProvider>
    </Provider>,
  )
  cleanupScreen = async () => screen.unmount()
  await screen
    .getByRole('button', { name: 'Choose background', exact: true })
    .click()
  return { screen, store }
}

/** Supplies null optional provider text while keeping every required API URL and attribution valid.
 * @returns Photo fixture at the HTTP boundary.
 * @example photo('one') // one valid Unsplash result
 */
function photo(id: string): UnsplashPhoto {
  return {
    id,
    width: 3840,
    height: 2160,
    description: null,
    altDescription: null,
    urls: {
      raw: `https://images.unsplash.com/photo-${id}?ixid=fixture`,
      small: `https://images.unsplash.com/photo-${id}?ixid=fixture&w=480`,
    },
    links: {
      html: `https://unsplash.com/photos/${id}`,
      downloadLocation: `https://api.unsplash.com/photos/${id}/download`,
    },
    photographer: {
      name: `Photographer ${id}`,
      username: `photographer_${id}`,
      profileUrl: `https://unsplash.com/@photographer_${id}`,
    },
  }
}

describe('Background gallery selection and operation lifecycle', () => {
  test('disables Crop Apply with a visible explanation when another window removes the uploaded source', async () => {
    // Arrange
    const uploadId = '00000000-0000-4000-8000-000000000001'
    const uploaded: BackgroundCatalogItem = {
      ...lake,
      source: { kind: 'upload', uploadId },
    }
    vi.spyOn(window.electron.backgrounds, 'list').mockResolvedValue({
      builtins: [lake],
      uploads: [uploaded],
    })
    const { screen, store } = await renderGallery({
      background: {
        ...DEFAULT_SETTINGS.background,
        uploads: [
          {
            id: uploadId,
            title: 'Alpine lake',
            width: 3840,
            height: 2160,
            format: 'webp',
            bytes: 1024,
            importedAt: '2026-09-08T00:00:00.000Z',
          },
        ],
      },
    })
    await screen.getByRole('tab', { name: 'Your images' }).click()
    await screen.getByRole('radio', { name: 'Alpine lake' }).click()
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Crop', exact: true })
      .click()
    await expect
      .element(
        screen
          .getByRole('dialog', { name: 'Crop background' })
          .getByRole('button', { name: 'Apply background' }),
      )
      .toBeEnabled()
    // Act
    store.dispatch(
      setSettings({
        ...store.getState().settings,
        background: { ...store.getState().settings.background, uploads: [] },
      }),
    )
    // Assert
    const crop = screen.getByRole('dialog', { name: 'Crop background' })
    await expect
      .element(
        crop
          .getByText('This uploaded image was removed. Select another image.')
          .last(),
      )
      .toBeVisible()
    await expect
      .element(crop.getByRole('button', { name: 'Apply background' }))
      .toBeDisabled()
    await crop.getByRole('button', { name: 'Reset crop' }).click()
    await expect
      .element(crop.getByRole('button', { name: 'Apply background' }))
      .toBeDisabled()
    expect(apply).not.toHaveBeenCalled()
  })

  test('selects a draft without applying and keeps photographer credits outside the radio', async () => {
    // Arrange
    const { screen } = await renderGallery()
    // Act
    await screen
      .getByRole('radio', { name: 'Alpine lake', exact: true })
      .click()
    // Assert
    await expect.element(screen.getByText('Preview: Alpine lake')).toBeVisible()
    expect(apply).not.toHaveBeenCalled()
    expect(
      screen
        .getByRole('radio', { name: 'Alpine lake', exact: true })
        .element()
        .querySelector('a'),
    ).toBeNull()
    await expect
      .element(screen.getByRole('link', { name: 'Mike Petrucci' }).first())
      .toHaveAttribute(
        'href',
        'https://unsplash.com/@mikepetrucci?utm_source=skills-desktop&utm_medium=referral',
      )
  })

  test('cancelling a new upload restores the previous source and saved crop', async () => {
    // Arrange
    const savedCrop = { x: 25, y: 25, width: 50, height: 50 }
    const { screen } = await renderGallery({
      background: {
        ...DEFAULT_SETTINGS.background,
        selected: {
          source: lake.source,
          crop: savedCrop,
          aspect: '16:9',
          displayId: '10000000-0000-4000-8000-000000000001',
        },
        hasAppliedImage: true,
      },
    })
    await expect.element(screen.getByText('Preview: Alpine lake')).toBeVisible()
    importImage.mockResolvedValue({
      source: {
        kind: 'upload-draft',
        draftId: '20000000-0000-4000-8000-000000000001',
      },
      title: 'New upload',
      width: 3840,
      height: 2160,
      image: { url: previewUrl, width: 3840, height: 2160 },
      credit: null,
    })
    // Act
    await screen.getByRole('button', { name: 'Upload image' }).click()
    await expect
      .element(screen.getByRole('heading', { name: 'Crop background' }))
      .toBeVisible()
    await screen
      .getByRole('button', { name: 'Cancel', exact: true })
      .last()
      .click()
    await screen
      .getByRole('button', { name: 'Apply background', exact: true })
      .click()
    // Assert
    expect(discard).toHaveBeenCalledWith({
      draftId: '20000000-0000-4000-8000-000000000001',
    })
    expect(apply.mock.calls[0]?.[0].source).toEqual({
      kind: 'builtin',
      builtinId: 'alpine-lake',
    })
    expect(apply.mock.calls[0]?.[0].crop).toEqual({
      x: 25,
      y: 25,
      width: 50,
      height: 50,
    })
  })

  test('Reset restores the full source and invalid crop disables Apply with an explanation', async () => {
    // Arrange
    const { screen } = await renderGallery()
    await screen
      .getByRole('radio', { name: 'Alpine lake', exact: true })
      .click()
    await screen
      .getByRole('button', { name: 'Crop', exact: true })
      .last()
      .click()
    const zoom = screen.getByRole('slider', { name: 'Zoom' })
    // Act
    await zoom.fill('3')
    // Assert
    await expect
      .element(screen.getByText('Select a larger area:', { exact: false }))
      .toBeVisible()
    await expect
      .element(
        screen.getByRole('button', { name: 'Apply background', exact: true }),
      )
      .toBeDisabled()
    // Act
    await screen.getByRole('button', { name: 'Reset crop' }).click()
    // Assert
    await expect
      .element(screen.getByText('Selected area: 3840 × 2160 px'))
      .toBeVisible()
    await expect
      .element(screen.getByRole('radio', { name: 'Original', exact: true }))
      .toHaveAttribute('aria-checked', 'true')
    await expect
      .element(
        screen.getByRole('button', { name: 'Apply background', exact: true }),
      )
      .toBeEnabled()
  })

  test('shows Starting and permits Close before acceptance while preventing duplicate Apply', async () => {
    // Arrange
    let accept:
      ((value: { operationId: number; requestId: string }) => void) | undefined
    apply.mockImplementation(
      async () =>
        new Promise((resolve) => {
          accept = resolve
        }),
    )
    const { screen } = await renderGallery()
    await screen
      .getByRole('radio', { name: 'Alpine lake', exact: true })
      .click()
    // Act
    await screen
      .getByRole('button', { name: 'Apply background', exact: true })
      .click()
    // Assert
    await expect.element(screen.getByText('Starting…')).toBeVisible()
    await expect
      .element(
        screen.getByRole('button', { name: 'Apply background', exact: true }),
      )
      .toBeDisabled()
    expect(apply).toHaveBeenCalledTimes(1)
    // Act
    await screen
      .getByRole('button', { name: 'Close', exact: true })
      .last()
      .click()
    accept?.({ operationId: 1, requestId: apply.mock.calls[0][0].requestId })
    // Assert
    await expect
      .poll(() => screen.getByRole('dialog').elements())
      .toHaveLength(0)
  })

  test('ignores delayed operation snapshots and shows failure in the real Toaster', async () => {
    // Arrange
    const { screen } = await renderGallery()
    const input = {
      source: lake.source,
      crop: DEFAULT_BACKGROUND_CROP,
      aspect: 'original' as const,
      operationId: 1,
      requestId: '30000000-0000-4000-8000-000000000001',
    }
    // Act
    broadcast({
      revision: 3,
      displayRetryRevision: 0,
      display: null,
      operation: {
        ...input,
        status: 'failed',
        error: { code: 'save-failed', message: 'Disk is full. Try again.' },
      },
    })
    broadcast({
      revision: 2,
      displayRetryRevision: 0,
      display: null,
      operation: { ...input, status: 'applying' },
    })
    // Assert
    await expect
      .element(
        screen.getByText('Background could not be applied', { exact: true }),
      )
      .toBeVisible()
    await expect
      .element(
        screen.getByText('Disk is full. Try again.', { exact: true }).first(),
      )
      .toBeVisible()
    expect(
      screen.getByText('Applying background…', { exact: false }).elements(),
    ).toHaveLength(0)
  })

  test('shows the hidden hint only when every active Section is opaque and focuses its range', async () => {
    // Arrange
    const { screen, store } = await renderGallery({
      windowOpacityMode: 'section',
      leftSectionOpacityPercent: 50,
      background: {
        ...DEFAULT_SETTINGS.background,
        selected: {
          source: lake.source,
          crop: DEFAULT_BACKGROUND_CROP,
          aspect: 'original',
          displayId: '40000000-0000-4000-8000-000000000001',
        },
        hasAppliedImage: true,
      },
    })
    await screen
      .getByRole('button', { name: 'Cancel', exact: true })
      .last()
      .click()
    // Assert
    expect(
      screen.getByText('Hidden at 100% opacity.', { exact: false }).elements(),
    ).toHaveLength(0)
    // Act
    store.dispatch(
      setSettings({
        ...store.getState().settings,
        leftSectionOpacityPercent: 100,
      }),
    )
    await screen.getByRole('button', { name: 'Adjust opacity' }).click()
    // Assert
    expect(document.activeElement).toBe(
      screen.getByRole('slider', { name: 'Left opacity' }).element(),
    )
  })
})

describe('Compact gallery and replay boundaries', () => {
  test('keeps footer actions inside a 600 by 400 window and restores the source focus after Crop Cancel', async () => {
    // Arrange
    const { screen } = await renderGallery()
    await page.viewport(600, 400)
    await screen
      .getByRole('radio', { name: 'Alpine lake', exact: true })
      .click()
    await screen
      .getByRole('button', { name: 'Crop', exact: true })
      .last()
      .click()
    // Act
    await screen.getByRole('radio', { name: '16:10', exact: true }).click()
    // Assert
    const footerButton = screen
      .getByRole('button', { name: 'Apply background', exact: true })
      .element()
      .getBoundingClientRect()
    expect(footerButton.bottom).toBeLessThanOrEqual(384)
    expect(footerButton.right).toBeLessThanOrEqual(584)
    const editor = screen.getByRole('group', {
      name: 'Move image within crop frame',
    })
    await expect.element(editor).toHaveAttribute('tabindex', '0')
    // Act
    await screen
      .getByRole('button', { name: 'Cancel', exact: true })
      .last()
      .click()
    // Assert
    await expect
      .poll(() => document.activeElement?.getAttribute('aria-label'))
      .toBe('Alpine lake')
    await screen
      .getByRole('button', { name: 'Apply background', exact: true })
      .click()
    expect(apply.mock.calls[0]?.[0].crop).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    })
    expect(apply.mock.calls[0]?.[0].aspect).toBe('original')
  })

  test('reopens a failed operation with its exact crop and retries only that acknowledged input', async () => {
    // Arrange
    currentSnapshot = {
      revision: 4,
      displayRetryRevision: 0,
      display: null,
      operation: {
        status: 'failed',
        operationId: 7,
        requestId: '50000000-0000-4000-8000-000000000001',
        source: lake.source,
        crop: { x: 25, y: 25, width: 50, height: 50 },
        aspect: '16:9',
        error: {
          code: 'save-failed',
          message: 'Disk full. Retry after freeing space.',
        },
      },
    }
    const { screen } = await renderGallery()
    // Act
    await screen
      .getByRole('button', { name: 'Retry Apply', exact: true })
      .click()
    // Assert
    expect(apply.mock.calls[0]?.[0].retryOperationId).toBe(7)
    expect(apply.mock.calls[0]?.[0].crop).toEqual({
      x: 25,
      y: 25,
      width: 50,
      height: 50,
    })
    expect(apply.mock.calls[0]?.[0].aspect).toBe('16:9')
  })

  test('allows explicit Clear while the first background is still being applied', async () => {
    // Arrange
    const { screen } = await renderGallery()
    broadcast({
      revision: 1,
      displayRetryRevision: 0,
      display: null,
      operation: {
        status: 'applying',
        operationId: 1,
        requestId: '60000000-0000-4000-8000-000000000001',
        source: lake.source,
        crop: DEFAULT_BACKGROUND_CROP,
        aspect: 'original',
      },
    })
    await screen
      .getByRole('button', { name: 'Cancel', exact: true })
      .last()
      .click()
    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Clear', exact: true }))
      .toBeEnabled()
    // Act
    await screen.getByRole('button', { name: 'Clear', exact: true }).click()
    // Assert
    await expect
      .element(screen.getByText('No background image', { exact: true }))
      .toBeVisible()
  })
})

describe('Unsplash gallery with real oRPC and TanStack Query', () => {
  test('deduplicates pages, preserves loaded results on tab return and explicitly refreshes page one', async () => {
    // Arrange
    const requestedPages: number[] = []
    fetchBoundary.mockImplementation(async (request) => {
      if (!(request instanceof Request))
        throw new Error('Expected oRPC Request')
      const input = z
        .object({ json: UnsplashSearchInputSchema })
        .parse(await request.json()).json
      requestedPages.push(input.page)
      const items =
        input.page === 1
          ? Array.from({ length: 30 }, (_, index) => photo(`first_${index}`))
          : [photo('first_0'), photo('last')]
      return Response.json({
        json: { items, nextPage: input.page === 1 ? 2 : null },
      })
    })
    const { screen } = await renderGallery()
    // Act
    await screen.getByRole('tab', { name: 'Unsplash', exact: true }).click()
    await expect
      .element(
        screen.getByRole('radio', { name: 'Photo by Photographer first_0' }),
      )
      .toBeVisible()
    await screen.getByRole('button', { name: 'Load more', exact: true }).click()
    await expect
      .element(screen.getByText('You have reached the end.'))
      .toBeVisible()
    await screen.getByRole('tab', { name: 'Built-in', exact: true }).click()
    await screen.getByRole('tab', { name: 'Unsplash', exact: true }).click()
    // Assert
    expect(requestedPages).toEqual([1, 2])
    expect(
      screen
        .getByRole('radio', { name: 'Photo by Photographer first_0' })
        .elements(),
    ).toHaveLength(1)
    expect(
      document.querySelectorAll('[data-background-photo-row]').length,
    ).toBeLessThan(8)
    // Act
    await screen
      .getByRole('button', { name: 'Refresh Unsplash', exact: true })
      .click()
    // Assert
    await expect.poll(() => requestedPages).toEqual([1, 2, 1])
    await expect
      .element(screen.getByRole('button', { name: 'Load more', exact: true }))
      .toBeVisible()
  })

  test('aborts an old search and rejects its late response after the new search succeeds', async () => {
    // Arrange
    let staleSignal: AbortSignal | undefined
    let finishOld: ((response: Response) => void) | undefined
    fetchBoundary.mockImplementation(async (request) => {
      if (!(request instanceof Request))
        throw new Error('Expected oRPC Request')
      const { json: input } = z
        .object({ json: UnsplashSearchInputSchema })
        .parse(await request.json())
      if (input.query === 'nature landscape') {
        staleSignal = request.signal
        return new Promise((resolve) => {
          finishOld = resolve
        })
      }
      return Response.json({
        json: { items: [photo('new_result')], nextPage: null },
      })
    })
    const { screen } = await renderGallery()
    await screen.getByRole('tab', { name: 'Unsplash', exact: true }).click()
    await expect.poll(() => Boolean(staleSignal)).toBe(true)
    // Act
    await screen
      .getByRole('searchbox', { name: 'Search Unsplash' })
      .fill('forest')
    await expect
      .element(
        screen.getByRole('radio', { name: 'Photo by Photographer new_result' }),
      )
      .toBeVisible()
    finishOld?.(
      Response.json({ json: { items: [photo('old_result')], nextPage: null } }),
    )
    // Assert
    expect(staleSignal?.aborted).toBe(true)
    expect(
      screen
        .getByRole('radio', { name: 'Photo by Photographer old_result' })
        .elements(),
    ).toHaveLength(0)
  })

  test('preserves a failed later page and never retries automatically on reconnect or remount', async () => {
    // Arrange
    fetchBoundary.mockImplementation(async (request) => {
      if (!(request instanceof Request))
        throw new Error('Expected oRPC Request')
      const { json: input } = z
        .object({ json: UnsplashSearchInputSchema })
        .parse(await request.json())
      return input.page === 1
        ? Response.json({
            json: {
              items: Array.from({ length: 30 }, (_, index) =>
                photo(`cached_${index}`),
              ),
              nextPage: 2,
            },
          })
        : Response.json(
            {
              json: {
                defined: true,
                code: 'RATE_LIMITED',
                status: 429,
                message: 'Quota reached. Try again later.',
                data: { retryAfterSeconds: 60 },
              },
            },
            { status: 429 },
          )
    })
    const { screen } = await renderGallery()
    await screen.getByRole('tab', { name: 'Unsplash', exact: true }).click()
    await screen.getByRole('button', { name: 'Load more', exact: true }).click()
    // Assert
    await expect
      .element(screen.getByText('Quota reached.', { exact: false }))
      .toBeVisible()
    await expect
      .element(
        screen.getByRole('radio', { name: 'Photo by Photographer cached_0' }),
      )
      .toBeVisible()
    // Act
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('focus'))
    await screen.getByRole('tab', { name: 'Built-in', exact: true }).click()
    await screen.getByRole('tab', { name: 'Unsplash', exact: true }).click()
    // Assert
    expect(fetchBoundary).toHaveBeenCalledTimes(2)
  })

  test('renders a far keyboard destination without allowing a stale focus request to steal search focus', async () => {
    // Arrange
    fetchBoundary.mockResolvedValue(
      Response.json({
        json: {
          items: Array.from({ length: 30 }, (_, index) =>
            photo(`key_${index}`),
          ),
          nextPage: null,
        },
      }),
    )
    const { screen } = await renderGallery()
    await screen.getByRole('tab', { name: 'Unsplash', exact: true }).click()
    const first = screen.getByRole('radio', {
      name: 'Photo by Photographer key_0',
    })
    await first.click()
    // Act
    await userEvent.keyboard('{End}')
    // Assert
    await expect
      .element(
        screen.getByRole('radio', { name: 'Photo by Photographer key_29' }),
      )
      .toBeVisible()
    await expect
      .poll(() => document.activeElement?.getAttribute('aria-label'))
      .toBe('Photo by Photographer key_29')
    // Act
    const active = document.activeElement
    active?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
    )
    const search = screen
      .getByRole('searchbox', { name: 'Search Unsplash' })
      .element()
    search.focus()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    // Assert
    expect(document.activeElement).toBe(search)
  })
})
