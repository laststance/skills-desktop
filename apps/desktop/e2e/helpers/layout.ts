import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { expect } from '../fixtures/electron-app'

/** The list header is a single `h-9` row in every width tier. */
const LIST_HEADER_HEIGHT_PX = 36

/**
 * Resize the main window's content area and wait until the renderer sees the
 * new width, so container-query tiers have re-evaluated before measuring.
 * @param electronApp - Launched Electron app from the fixture.
 * @param appWindow - Main window page.
 * @param widthPx - Target content width.
 * @param heightPx - Target content height.
 * @example await resizeWindowContent(electronApp, appWindow, 800, 800)
 */
export async function resizeWindowContent(
  electronApp: ElectronApplication,
  appWindow: Page,
  widthPx: number,
  heightPx: number,
): Promise<void> {
  const nativeWindow = await electronApp.browserWindow(appWindow)
  await nativeWindow.evaluate(
    (window, size) => window.setContentSize(size.width, size.height),
    { width: widthPx, height: heightPx },
  )
  await expect
    .poll(async () => appWindow.evaluate(() => window.innerWidth))
    .toBe(widthPx)
}

/**
 * Assert the list header stays its one {@link LIST_HEADER_HEIGHT_PX}px row and
 * that every control in it (master checkbox and each action button) sits
 * fully inside its rect, which is how a wrap or overflow would show up.
 * Named for the list header on purpose — the height is pinned to its `h-9`.
 * @param listHeader - The `List header` group.
 * @example await expectListHeaderRowIntact(listHeader)
 */
export async function expectListHeaderRowIntact(
  listHeader: Locator,
): Promise<void> {
  const headerBox = await listHeader.boundingBox()
  if (headerBox === null) throw new Error('Expected the list header to render')
  expect(headerBox.height).toBe(LIST_HEADER_HEIGHT_PX)

  const controls = await listHeader.locator('button, [role="checkbox"]').all()
  expect(controls.length).toBeGreaterThan(0)
  for (const control of controls) {
    const controlBox = await control.boundingBox()
    if (controlBox === null) continue
    const label = (await control.getAttribute('aria-label')) ?? 'control'
    expect(controlBox.x, `${label} left edge`).toBeGreaterThanOrEqual(
      headerBox.x,
    )
    expect(controlBox.y, `${label} top edge`).toBeGreaterThanOrEqual(
      headerBox.y,
    )
    expect(
      controlBox.x + controlBox.width,
      `${label} right edge`,
    ).toBeLessThanOrEqual(headerBox.x + headerBox.width)
    expect(
      controlBox.y + controlBox.height,
      `${label} bottom edge`,
    ).toBeLessThanOrEqual(headerBox.y + headerBox.height)
  }
}
