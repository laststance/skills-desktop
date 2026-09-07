import { afterEach, expect, test, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { BackgroundCatalogItem } from '@/shared/backgrounds'

import { BackgroundPhotoGrid } from './BackgroundPhotoGrid'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test.each(['removed destination', 'new focus owner'] as const)(
  'a delayed virtual focus frame cannot steal focus after a %s',
  async (change) => {
    // Arrange
    const items: BackgroundCatalogItem[] = Array.from(
      { length: 30 },
      (_, index) => ({
        source: {
          kind: 'upload',
          uploadId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        },
        title: `Pending photo ${index}`,
        width: 3840,
        height: 2160,
        thumbnail: null,
        credit: null,
      }),
    )
    const scrollPositions = new Map<string, number>()
    const grid = (photos: BackgroundCatalogItem[]) => (
      <div style={{ width: 600, height: 380, display: 'flex' }}>
        <BackgroundPhotoGrid
          items={photos}
          selectedKey=""
          appliedKey=""
          scope="stable"
          active
          scrollPositions={scrollPositions}
          onSelect={() => undefined}
          onRemove={() => undefined}
          onEndReached={() => undefined}
        />
      </div>
    )
    const screen = await render(grid(items))
    const frames = new Map<number, FrameRequestCallback>()
    let sequence = 100_000
    try {
      await screen
        .getByRole('radio', { name: 'Pending photo 0', exact: true })
        .click()
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(
        (callback) => {
          const id = ++sequence
          frames.set(id, callback)
          return id
        },
      )
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
        frames.delete(id)
      })
      // Act: hold only the scheduling boundary while actual React and react-window render their destination.
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
      )
      if (change === 'removed destination')
        await screen.rerender(grid(items.slice(0, 29)))
      else {
        await expect
          .element(
            screen.getByRole('radio', {
              name: 'Pending photo 28',
              exact: true,
            }),
          )
          .toBeVisible()
        screen
          .getByRole('radio', { name: 'Pending photo 28', exact: true })
          .element()
          .focus()
      }
      const owner = document.activeElement
      for (const callback of frames.values()) callback(performance.now())
      frames.clear()
      // Assert
      expect(document.activeElement).toBe(owner)
      expect(document.activeElement?.getAttribute('aria-label')).not.toBe(
        'Pending photo 29',
      )
    } finally {
      vi.restoreAllMocks()
      await screen.unmount()
    }
  },
)

test('an undecodable thumbnail keeps its labelled radio usable and ordinary typing does not change selection', async () => {
  // Arrange
  const select = vi.fn()
  const screen = await render(
    <div style={{ width: 600, height: 380, display: 'flex' }}>
      <BackgroundPhotoGrid
        items={[
          {
            source: { kind: 'builtin', builtinId: 'alpine-lake' },
            title: 'Unavailable thumbnail',
            width: 3840,
            height: 2160,
            thumbnail: {
              url: 'data:image/png;base64,bm90LXBuZw==',
              width: 480,
              height: 270,
            },
            credit: null,
          },
        ]}
        selectedKey=""
        appliedKey=""
        scope="builtin"
        active
        scrollPositions={new Map()}
        onSelect={select}
        onRemove={() => undefined}
        onEndReached={() => undefined}
      />
    </div>,
  )
  try {
    const radio = screen.getByRole('radio', {
      name: 'Unavailable thumbnail',
      exact: true,
    })
    // Act
    radio.element().focus()
    await userEvent.keyboard('a')
    // Assert
    await expect.element(radio).toBeVisible()
    await expect
      .poll(() => radio.element().querySelector('img')?.style.visibility)
      .toBe('hidden')
    expect(document.activeElement).toBe(radio.element())
    expect(select).not.toHaveBeenCalled()
  } finally {
    await screen.unmount()
  }
})

test('removing the remembered photo retains a visible Tab stop and arrows continue from the current scrolled row', async () => {
  // Arrange
  await page.viewport(800, 600)
  vi.stubGlobal('electron', { shell: { openExternal: async () => undefined } })
  const items: BackgroundCatalogItem[] = Array.from(
    { length: 60 },
    (_, index) => ({
      source: {
        kind: 'upload',
        uploadId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      },
      title: `Library photo ${index}`,
      width: 3840,
      height: 2160,
      thumbnail: null,
      credit: null,
    }),
  )
  const select = vi.fn()
  const scrollPositions = new Map<string, number>()
  const grid = (photos: BackgroundCatalogItem[]) => (
    <div style={{ width: 600, height: 380, display: 'flex' }}>
      <BackgroundPhotoGrid
        items={photos}
        selectedKey=""
        appliedKey=""
        scope="uploads"
        active
        scrollPositions={scrollPositions}
        onSelect={select}
        onRemove={() => undefined}
        onEndReached={() => undefined}
      />
    </div>
  )
  const screen = await render(grid(items))
  try {
    await screen
      .getByRole('radio', { name: 'Library photo 0', exact: true })
      .click()
    const group = screen.getByRole('radiogroup').element()
    const scroller = group.firstElementChild
    if (!(scroller instanceof HTMLElement))
      throw new Error('The real virtual list must expose its scroller')
    scroller.scrollTop = 1800
    await expect
      .element(
        screen.getByRole('radio', { name: 'Library photo 30', exact: true }),
      )
      .toBeVisible()
    // Keep keyboard focus in a stable row action while another window removes the remembered radio.
    screen
      .getByRole('button', { name: 'Remove Library photo 32', exact: true })
      .element()
      .focus()
    // Act
    await screen.rerender(grid(items.slice(1)))
    await expect
      .poll(() => group.querySelectorAll('[role="radio"][tabindex="0"]').length)
      .toBe(1)
    await userEvent.keyboard('{ArrowRight}')
    // Assert
    await expect
      .poll(() => document.activeElement?.getAttribute('aria-label'))
      .toBe('Library photo 32')
    expect(select.mock.calls.at(-1)?.[0].title).toBe('Library photo 32')
    expect(scroller.scrollTop).toBe(1800)
  } finally {
    await screen.unmount()
  }
})
