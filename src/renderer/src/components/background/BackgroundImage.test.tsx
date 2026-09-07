import { chromium, type Browser, type Page } from '@playwright/test'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import type { BackgroundDisplay, BackgroundLayout } from '@/shared/backgrounds'

import { BackgroundImage } from './BackgroundImage'

let browser: Browser
let page: Page
let fixtureBytes: Buffer
const display: BackgroundDisplay = {
  selection: {
    source: { kind: 'builtin', builtinId: 'alpine-lake' },
    displayId: '00000000-0000-4000-8000-000000000001',
    crop: { x: 25, y: 25, width: 50, height: 50 },
    aspect: 'original',
  },
  // Tiny real pixel fixtures make every boundary observable; Apply's resolution validation runs in Main.
  image: {
    url: 'https://images.unsplash.com/photo-pixel-fixture?ixid=retained',
    width: 120,
    height: 80,
  },
  crop: { x: 25, y: 25, width: 50, height: 50 },
  title: 'Pixel fixture',
  credit: null,
}

beforeAll(async () => {
  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 320, height: 200 } })
  fixtureBytes = await sharp(
    Buffer.from(
      '<svg width="120" height="80" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="80" fill="#ff00ff"/><rect x="30" y="20" width="30" height="40" fill="#00ff00"/><rect x="60" y="20" width="30" height="40" fill="#0000ff"/></svg>',
    ),
  )
    .png()
    .toBuffer()
  await page.route('https://images.unsplash.com/**', async (route) =>
    route.fulfill({ contentType: 'image/png', body: fixtureBytes }),
  )
})
afterAll(async () => {
  await browser?.close()
})

/** Paints the real {@link BackgroundImage} in Chromium so assertions sample composited pixels, not CSS arithmetic.
 * @returns RGBA screenshot bytes; black pixels are the theme fallback used by the fixture.
 * @example const pixels = await renderPixels('fit', 320, 200)
 */
async function renderPixels(
  layout: BackgroundLayout,
  width: number,
  height: number,
  selected = display,
): Promise<Buffer> {
  await page.setViewportSize({ width, height })
  await page.setContent(
    `<body style="margin:0;background:black"><div style="width:${width}px;height:${height}px">${renderToStaticMarkup(<BackgroundImage display={selected} layout={layout} retryRevision={0} />)}</div></body>`,
  )
  return sharp(await page.screenshot())
    .ensureAlpha()
    .raw()
    .toBuffer()
}

/** Reads one known screenshot pixel so each expected color is hard-coded in the behavior test.
 * @returns The four RGBA bytes at the requested viewport coordinate.
 * @example pixelAt(bytes, 320, 10, 20) // [0, 255, 0, 255]
 */
function pixelAt(bytes: Buffer, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4
  return Array.from(bytes.subarray(offset, offset + 4))
}

describe('accepted background crop pixels', () => {
  test('fills the viewport with the accepted region while excluding the outer magenta source', async () => {
    // Arrange / Act
    const pixels = await renderPixels('fill', 320, 200)
    // Assert
    expect(pixelAt(pixels, 320, 0, 0)).toEqual([0, 255, 0, 255])
    expect(pixelAt(pixels, 320, 319, 199)).toEqual([0, 0, 255, 255])
    expect(pixelAt(pixels, 320, 100, 100)).toEqual([0, 255, 0, 255])
    expect(pixelAt(pixels, 320, 220, 100)).toEqual([0, 0, 255, 255])
    expect(
      pixels.filter((value, index) => index % 4 === 0 && value > 0),
    ).toHaveLength(0)
  })

  test('keeps Fit letterboxes on the theme fallback instead of exposing excluded pixels', async () => {
    // Arrange / Act
    const pixels = await renderPixels('fit', 320, 200)
    // Assert — 60×40 accepted pixels fit at 300×200 with ten-pixel side bars.
    expect(pixelAt(pixels, 320, 4, 100)).toEqual([0, 0, 0, 255])
    expect(pixelAt(pixels, 320, 20, 100)).toEqual([0, 255, 0, 255])
    expect(pixelAt(pixels, 320, 300, 100)).toEqual([0, 0, 255, 255])
    expect(pixelAt(pixels, 320, 315, 100)).toEqual([0, 0, 0, 255])
    expect(
      pixels.filter((value, index) => index % 4 === 0 && value > 0),
    ).toHaveLength(0)
  })

  test('repeats only the cropped 60×40 region in Tile, including partial edge tiles', async () => {
    // Arrange / Act
    const pixels = await renderPixels('tile', 160, 100)
    // Assert
    expect(pixelAt(pixels, 160, 5, 5)).toEqual([0, 255, 0, 255])
    expect(pixelAt(pixels, 160, 35, 5)).toEqual([0, 0, 255, 255])
    expect(pixelAt(pixels, 160, 65, 45)).toEqual([0, 255, 0, 255])
    expect(pixelAt(pixels, 160, 95, 85)).toEqual([0, 0, 255, 255])
    expect(pixelAt(pixels, 160, 159, 99)).toEqual([0, 0, 255, 255])
    expect(
      pixels.filter((value, index) => index % 4 === 0 && value > 0),
    ).toHaveLength(0)
  })

  test.each([1.5, 2])(
    'keeps excluded source colors out of Tile at device scale %s',
    async (deviceScaleFactor) => {
      // Arrange — fractional and Retina scaling must not sample outside the original crop boundary.
      const densePage = await browser.newPage({
        viewport: { width: 160, height: 100 },
        deviceScaleFactor,
      })
      try {
        await densePage.route('https://images.unsplash.com/**', async (route) =>
          route.fulfill({ contentType: 'image/png', body: fixtureBytes }),
        )
        // Act
        await densePage.setContent(
          `<body style="margin:0;background:black"><div style="width:160px;height:100px">${renderToStaticMarkup(<BackgroundImage display={display} layout="tile" retryRevision={0} />)}</div></body>`,
        )
        const pixels = await sharp(await densePage.screenshot())
          .ensureAlpha()
          .raw()
          .toBuffer()
        // Assert — magenta excluded pixels have red; neither green nor blue accepted pixels do.
        expect(Array.from(pixels.subarray(0, 4))).toEqual([0, 255, 0, 255])
        expect(
          pixels.filter((value, index) => index % 4 === 0 && value > 0),
        ).toHaveLength(0)
      } finally {
        await densePage.close()
      }
    },
  )

  test('preserves the accepted crop when Fit changes from a wide to a tall viewport', async () => {
    // Arrange
    await renderPixels('fit', 320, 200)
    // Act — the existing SVG resizes without reconstruction.
    await page.setViewportSize({ width: 80, height: 160 })
    await page.locator('body > div').evaluate((element) => {
      element.setAttribute('style', 'width:80px;height:160px')
    })
    const pixels = await sharp(await page.screenshot())
      .ensureAlpha()
      .raw()
      .toBuffer()
    // Assert
    expect(pixelAt(pixels, 80, 40, 30)).toEqual([0, 0, 0, 255])
    expect(pixelAt(pixels, 80, 10, 80)).toEqual([0, 255, 0, 255])
    expect(pixelAt(pixels, 80, 70, 80)).toEqual([0, 0, 255, 255])
    expect(pixelAt(pixels, 80, 40, 130)).toEqual([0, 0, 0, 255])
  })

  test('uses the same floor boundary as Main when percentages contain fractional source pixels', async () => {
    // Arrange — x/y floor to 30/20 and width/height to 60/40.
    const fractional: BackgroundDisplay = {
      ...display,
      crop: { x: 25.5, y: 25.5, width: 50.5, height: 50.5 },
    }
    // Act
    const pixels = await renderPixels('tile', 60, 40, fractional)
    // Assert
    expect(pixelAt(pixels, 60, 0, 0)).toEqual([0, 255, 0, 255])
    expect(pixelAt(pixels, 60, 29, 39)).toEqual([0, 255, 0, 255])
    expect(pixelAt(pixels, 60, 30, 0)).toEqual([0, 0, 255, 255])
    expect(pixelAt(pixels, 60, 59, 39)).toEqual([0, 0, 255, 255])
  })

  test('retains the original hotlink and ixid without rendering a rehosted image', async () => {
    // Arrange / Act
    await renderPixels('fit', 320, 200)
    // Assert
    expect(
      await page.locator('img[data-background-resource]').getAttribute('src'),
    ).toBe('https://images.unsplash.com/photo-pixel-fixture?ixid=retained')
    expect(await page.locator('canvas').count()).toBe(0)
  })
})
