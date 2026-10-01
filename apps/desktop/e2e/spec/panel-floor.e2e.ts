import type { Page } from '@playwright/test'

import { test, expect } from '../fixtures/electron-app'
import {
  expectListHeaderRowIntact,
  resizeWindowContent,
} from '../helpers/layout'
import { waitForInitialScan } from '../helpers/redux'

/**
 * A skill present in the committed snapshot HOME — staged skill dirs land
 * after the app's initial scan, so only snapshot skills are clickable.
 */
const SNAPSHOT_SKILL_NAME = 'azure-ai'

/**
 * Read both panels' rendered widths, scoped under the Group's `data-group`
 * marker so a future nested Group can't reorder the [center, right] indexes.
 * @param appWindow - Main window page.
 * @returns Center and right panel widths in CSS pixels.
 * @example const [center, right] = await panelWidths(appWindow)
 */
async function panelWidths(appWindow: Page): Promise<number[]> {
  return appWindow
    .locator('[data-group] [data-panel]')
    .evaluateAll((panels) =>
      panels.map((panel) => panel.getBoundingClientRect().width),
    )
}

/**
 * The 264px panel floor in the real window. Keyboard resizes move ±5% of the
 * group per Arrow press (±100% per Home/End) and the library stores floors as
 * `toFixed(3)` percentages, so widths land within ~0.005% of 264 — the
 * assertions round to the nearest half pixel for that 1/64px quantization.
 */
test('keeps both panels at their 264px floor while the separator is dragged past it at the minimum window', async ({
  electronApp,
  appWindow,
}) => {
  // Arrange — 1200px gives the split real room to move (928px group). The
  // snapshot HOME already ships the azure-* rows this test measures.
  await waitForInitialScan(appWindow)
  await resizeWindowContent(electronApp, appWindow, 1200, 800)
  // The separator is a 0px-wide focusable element (its 10px hit target is
  // virtual), so it has no bounding box for `toBeVisible` — assert it takes
  // keyboard focus instead.
  const separator = appWindow.getByRole('separator')
  await separator.focus()
  await expect(separator).toBeFocused()

  // Act — drag the split fully left, then fully right, past every floor.
  for (let i = 0; i < 60; i++) await appWindow.keyboard.press('ArrowLeft')
  // Assert — the center panel pins at 264px, never the ~106px the old 20%
  // floor allowed. toBeCloseTo(…, 0): the stored % floor renders ~264.0.
  await expect
    .poll(async () => (await panelWidths(appWindow))[0])
    .toBeCloseTo(264, 0)

  for (let i = 0; i < 120; i++) await appWindow.keyboard.press('ArrowRight')
  await expect
    .poll(async () => (await panelWidths(appWindow))[1])
    .toBeCloseTo(264, 0)

  // Act — the pointer path clamps identically: grab the separator's 10px
  // virtual hit target at the split and drag far past the left floor.
  const splitX = await appWindow.evaluate(() => {
    const first = document.querySelector('[data-group] [data-panel]')
    if (!first) throw new Error('left panel not found for split measurement')
    return first.getBoundingClientRect().right
  })
  // A positive split inside the drag path proves the pointer moves the real
  // separator — a 0 here would mean the panels never mounted.
  expect(splitX).toBeGreaterThan(0)
  await appWindow.mouse.move(splitX, 400)
  await appWindow.mouse.down()
  await appWindow.mouse.move(120, 400, { steps: 8 })
  await appWindow.mouse.up()
  await expect
    .poll(async () => (await panelWidths(appWindow))[0])
    .toBeCloseTo(264, 0)

  // Act — drop to the 800×600 minimum window, where the two floors exactly
  // fill the 528px group (sidebar 272px, separator 0px).
  await resizeWindowContent(electronApp, appWindow, 800, 600)
  for (const index of [0, 1]) {
    await expect
      .poll(async () => (await panelWidths(appWindow))[index])
      .toBeCloseTo(264, 0)
  }

  // Assert — the window shows no horizontal overflow and the list header's
  // controls all fit inside its one 36px row.
  const overflow = await appWindow.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  await expectListHeaderRowIntact(
    appWindow.getByRole('group', { name: 'List header' }),
  )

  // Assert — select the skill so the detail pane mounts, then check no
  // descendant geometry crosses the pane's right edge. Ancestor
  // `overflow-hidden` clips paint but not layout rects, so this sees the
  // detail metrics being crushed even when the document-level scrollWidth
  // check above cannot.
  await appWindow.locator(`[data-skill-name="${SNAPSHOT_SKILL_NAME}"]`).click()
  const rightPanel = appWindow.locator('[data-group] [data-panel]').nth(1)
  // Wait for the detail pane to actually mount before measuring — an empty
  // panel has no descendants to overflow and would pass vacuously.
  await expect(rightPanel.getByText(SNAPSHOT_SKILL_NAME).first()).toBeVisible()
  const crushed = await rightPanel.evaluate((panel) => {
    const panelRight = panel.getBoundingClientRect().right
    // Children of an overflow-x auto/scroll container (the detail pane's tab
    // strip is one) legitimately lay out wider than the pane — skip those.
    const insideScroller = (el: Element) => {
      let current: Element | null = el
      while (current !== null && current !== panel) {
        const overflowX = getComputedStyle(current).overflowX
        if (overflowX === 'auto' || overflowX === 'scroll') return true
        current = current.parentElement
      }
      return false
    }
    const offenders: string[] = []
    for (const el of Array.from(panel.querySelectorAll('*'))) {
      if (insideScroller(el)) continue
      if (el.getBoundingClientRect().right > panelRight + 0.5) {
        offenders.push(
          `${el.tagName.toLowerCase()} ${el.className?.toString().slice(0, 60)}`,
        )
      }
    }
    return offenders
  })
  expect(crushed).toEqual([])

  // Assert — the Marketplace tab shares the center panel, so the floor also
  // bounds it; switching at the minimum window must not overflow either. Wait
  // for the marketplace search box so the pane is measured populated, not
  // mid-mount (an empty panel can't overflow → vacuous pass).
  await appWindow.getByRole('tab', { name: 'Marketplace' }).click()
  await expect(appWindow.getByPlaceholder(/Search skills/)).toBeVisible()
  const marketplaceOverflow = await appWindow.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  )
  expect(marketplaceOverflow).toBeLessThanOrEqual(0)
})
