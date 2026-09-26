import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ElectronApplication, Locator, Page } from '@playwright/test'

import { test, expect } from '../fixtures/electron-app'
import {
  dispatchAction,
  refreshSkillsState,
  waitForInitialScan,
} from '../helpers/redux'

/** The list header is a single `h-9` row in every width tier. */
const LIST_HEADER_HEIGHT_PX = 36
/** Window content height used for both widths; above the 600px minimum. */
const WINDOW_CONTENT_HEIGHT_PX = 800
/**
 * Window content widths and the header tier each one lands in at the default
 * 50/50 split. The tiers key off the header's content box, the center column
 * minus 57px of column padding, the list's scrollbar gutter and row inset, and
 * header padding: the 1200px launch size gives it about 407px (narrow, below
 * 30rem), while 1100px (about 357px) and the 800px minimum (about 207px) fall
 * below 24rem into the compact tier.
 */
const WINDOW_TIERS = [
  { widthPx: 1200, tier: 'narrow' },
  { widthPx: 1100, tier: 'compact' },
  { widthPx: 800, tier: 'compact' },
] as const

/** Header width tier the primary action's visible label reveals. */
type HeaderTier = (typeof WINDOW_TIERS)[number]['tier']

/** The primary Delete/Unlink action: its accessible name and per-tier label. */
interface PrimaryAction {
  name: string
  visibleLabelByTier: Record<HeaderTier, string>
}
/** Two-digit count, so the primary label is as long as it usually gets. */
const STAGED_SKILL_COUNT = 28
/** Shared name prefix; searching it shows exactly the staged rows. */
const STAGED_SKILL_PREFIX = 'list-header-'

/**
 * Stage source skills under `~/.agents/skills` and link each one into
 * `~/.cursor/skills`, so the same rows fill both the global view (Delete) and
 * Cursor's view (Unlink).
 * @param isolatedHome - E2E fixture HOME.
 * @returns The staged skill names in A-to-Z order.
 * @example stageLinkedSkills(home) // => ['list-header-01', ..., 'list-header-28']
 */
function stageLinkedSkills(isolatedHome: string): string[] {
  const sourceDir = join(isolatedHome, '.agents', 'skills')
  const cursorDir = join(isolatedHome, '.cursor', 'skills')
  mkdirSync(cursorDir, { recursive: true })
  const names = Array.from(
    { length: STAGED_SKILL_COUNT },
    (_, index) => `${STAGED_SKILL_PREFIX}${String(index + 1).padStart(2, '0')}`,
  )
  for (const name of names) {
    const skillDir = join(sourceDir, name)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `# ${name}\n\nList header layout fixture.\n`,
    )
    symlinkSync(skillDir, join(cursorDir, name))
  }
  return names
}

/**
 * Resize the main window's content area and wait until the renderer sees the
 * new width, so container-query tiers have re-evaluated before measuring.
 * @param electronApp - Launched Electron app from the fixture.
 * @param appWindow - Main window page.
 * @param widthPx - Target content width.
 * @example await resizeWindowContent(electronApp, appWindow, 800)
 */
async function resizeWindowContent(
  electronApp: ElectronApplication,
  appWindow: Page,
  widthPx: number,
): Promise<void> {
  const nativeWindow = await electronApp.browserWindow(appWindow)
  await nativeWindow.evaluate(
    (window, size) => window.setContentSize(size.width, size.height),
    { width: widthPx, height: WINDOW_CONTENT_HEIGHT_PX },
  )
  await expect
    .poll(async () => appWindow.evaluate(() => window.innerWidth))
    .toBe(widthPx)
}

/**
 * Read an element's top edge in CSS pixels.
 * @param locator - Element to measure.
 * @returns The bounding box's `y`.
 * @example await readTopEdge(appWindow.locator('[data-skill-name="task"]')) // => 188
 */
async function readTopEdge(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('Expected a rendered element to measure')
  return box.y
}

/**
 * Assert the header is one 36px row and that every control in it (master
 * checkbox and each action button) sits fully inside its rect, which is how a
 * wrap or overflow would show up.
 * @param listHeader - The `List header` group.
 * @example await expectOneRowWithControlsInside(listHeader)
 */
async function expectOneRowWithControlsInside(
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

/**
 * Assert the header spans exactly the cards' columns, so it reads as the
 * list's own top row: the same left edge, and a right edge that clears the
 * list's scrollbar gutter just as the cards do.
 * @param listHeader - The `List header` group.
 * @param card - Any rendered skill card.
 * @example await expectHeaderSharesCardEdges(listHeader, firstCard)
 */
async function expectHeaderSharesCardEdges(
  listHeader: Locator,
  card: Locator,
): Promise<void> {
  const headerBox = await listHeader.boundingBox()
  const cardBox = await card.boundingBox()
  if (headerBox === null || cardBox === null) {
    throw new Error('Expected the list header and a card to render')
  }
  expect(headerBox.x, 'header left edge').toBeCloseTo(cardBox.x, 0)
  expect(headerBox.x + headerBox.width, 'header right edge').toBeCloseTo(
    cardBox.x + cardBox.width,
    0,
  )
}

/**
 * Run the per-width layout checks: the header spans the cards' columns, the
 * first tick leaves the list where it was, and a full selection still fits the
 * header's one row with the tier's primary label on screen.
 * @param appWindow - Main window page.
 * @param primaryAction - The header's Delete/Unlink name and per-tier label.
 * @param tier - The tier the current window width puts the header in.
 * @example await expectSelectionKeepsLayout(appWindow, globalDelete, 'compact')
 */
async function expectSelectionKeepsLayout(
  appWindow: Page,
  primaryAction: PrimaryAction,
  tier: HeaderTier,
): Promise<void> {
  const listHeader = appWindow.getByRole('group', { name: 'List header' })
  const firstCard = appWindow.locator(
    `[data-skill-name="${STAGED_SKILL_PREFIX}01"]`,
  )
  await expect(firstCard).toBeVisible()
  await expectHeaderSharesCardEdges(listHeader, firstCard)
  await expectOneRowWithControlsInside(listHeader)
  const listTopBeforeTick = await readTopEdge(firstCard)

  // First tick, through the card's own checkbox.
  await firstCard.hover()
  await firstCard
    .getByRole('checkbox', { name: `Select ${STAGED_SKILL_PREFIX}01` })
    .click()
  await expect(listHeader).toContainText('1 selected')
  expect(await readTopEdge(firstCard)).toBe(listTopBeforeTick)
  await expectOneRowWithControlsInside(listHeader)

  // Then every staged row, through the master checkbox.
  await listHeader
    .getByRole('checkbox', {
      name: `Select all ${STAGED_SKILL_COUNT} visible skills`,
    })
    .click()
  await expect(listHeader).toContainText(`${STAGED_SKILL_COUNT} selected`)
  const primaryButton = listHeader.getByRole('button', {
    name: primaryAction.name,
  })
  await expect(primaryButton).toBeVisible()
  // innerText skips the label span the tier hides, so it names the tier.
  await expect(primaryButton).toHaveText(
    primaryAction.visibleLabelByTier[tier],
    { useInnerText: true },
  )
  expect(await readTopEdge(firstCard)).toBe(listTopBeforeTick)
  await expectOneRowWithControlsInside(listHeader)

  // Back to rest for the next width.
  await listHeader.getByRole('button', { name: 'Clear selection' }).click()
  await expect(listHeader).not.toContainText('selected')
}

/**
 * The list header's container-query tiers, checked in the real app window,
 * where the sidebar, the panel split and the real scrollbar give the header its
 * true width. At the 1200px launch size it shows the narrow tier, and at 1100px
 * and the 800px minimum the compact tier. In each it spans the cards' columns
 * and stays one 36px row with every control inside it, and the first tick
 * never moves the list.
 */
test('keeps the list header one 36px row aligned with the cards at 1200px, 1100px and 800px windows in the global view', async ({
  electronApp,
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  stageLinkedSkills(isolatedHome)
  await waitForInitialScan(appWindow)
  await refreshSkillsState(appWindow)
  await dispatchAction(appWindow, {
    type: 'ui/setSearchQuery',
    payload: STAGED_SKILL_PREFIX,
  })

  for (const { widthPx, tier } of WINDOW_TIERS) {
    // Act
    await resizeWindowContent(electronApp, appWindow, widthPx)

    // Assert
    await expectSelectionKeepsLayout(
      appWindow,
      {
        name: `Move ${STAGED_SKILL_COUNT} selected skills to app trash`,
        visibleLabelByTier: {
          narrow: `Delete ${STAGED_SKILL_COUNT} skills`,
          compact: `Delete ${STAGED_SKILL_COUNT}`,
        },
      },
      tier,
    )
  }
})

test('keeps the list header one 36px row aligned with the cards at 1200px, 1100px and 800px windows in the Cursor view', async ({
  electronApp,
  appWindow,
  isolatedHome,
}) => {
  // Arrange
  stageLinkedSkills(isolatedHome)
  await waitForInitialScan(appWindow)
  await refreshSkillsState(appWindow)
  await dispatchAction(appWindow, { type: 'ui/selectAgent', payload: 'cursor' })
  await dispatchAction(appWindow, {
    type: 'ui/setSearchQuery',
    payload: STAGED_SKILL_PREFIX,
  })

  for (const { widthPx, tier } of WINDOW_TIERS) {
    // Act
    await resizeWindowContent(electronApp, appWindow, widthPx)

    // Assert
    await expectSelectionKeepsLayout(
      appWindow,
      {
        name: `Unlink ${STAGED_SKILL_COUNT} selected skills from Cursor`,
        visibleLabelByTier: {
          narrow: `Unlink ${STAGED_SKILL_COUNT} from Cursor`,
          compact: `Unlink ${STAGED_SKILL_COUNT}`,
        },
      },
      tier,
    )
  }
})
