import type { Page } from '@playwright/test'

import { test, expect } from '../fixtures/electron-app'
import { dispatchAction, waitForInitialScan } from '../helpers/redux'

/**
 * A SkillSearchResult shape (rank/name/repo/url) seeded straight into the
 * marketplace slice so the preview renders without hitting skills.sh. The
 * <webview> guest page never loads over the network in CI — these specs assert
 * the host-side contract (DOM node identity + focus + Escape), which is exactly
 * what proves "expanding never re-parents/reloads the webview".
 */
const PREVIEW_SKILL = {
  rank: 1,
  name: 'find-skills',
  repo: 'vercel-labs/skills',
  url: 'https://skills.sh/vercel-labs/skills/find-skills',
  installCount: 1,
}

/**
 * Open the Marketplace preview for PREVIEW_SKILL by switching tabs and seeding
 * the preview slice, then wait for the in-pane Expand affordance to render.
 */
async function openPreview(appWindow: Page) {
  await appWindow.getByRole('tab', { name: 'Marketplace' }).click()
  await dispatchAction(appWindow, {
    type: 'marketplace/setPreviewSkill',
    payload: PREVIEW_SKILL,
  })
  const expandButton = appWindow.getByRole('button', { name: 'Expand preview' })
  await expect(expandButton).toBeVisible()
  return expandButton
}

test('Marketplace preview expands into a focused overlay without re-parenting the webview', async ({
  appWindow,
}) => {
  // Arrange — boot, open the preview, and tag the live <webview> node. The tag
  // survives only if the node is never removed/re-inserted; a re-parent would
  // remount it (dropping the marker) and reload the guest page (failing AC#5).
  await waitForInitialScan(appWindow)
  const expandButton = await openPreview(appWindow)

  await appWindow.evaluate(() => {
    const webview = document.querySelector<HTMLElement>('webview')
    if (!webview) throw new Error('preview <webview> not rendered')
    webview.dataset.e2eIdentity = 'preview-node-stable'
    webview.dataset.loadStarts = '0'
    webview.addEventListener('did-start-loading', () => {
      const current = Number(webview.dataset.loadStarts ?? '0')
      webview.dataset.loadStarts = String(current + 1)
    })
  })

  // Reset the load-start counter right before toggling so only reloads caused
  // by the expand/collapse round-trip are counted (not the initial mount load).
  await appWindow.evaluate(() => {
    const webview = document.querySelector<HTMLElement>('webview')
    if (webview) webview.dataset.loadStarts = '0'
  })

  // Act — expand into the overlay.
  await expandButton.click()

  // Assert — the focused dialog is up and focus moved into it (to the close
  // button), per modal a11y.
  const dialog = appWindow.getByRole('dialog', { name: /find-skills preview/i })
  await expect(dialog).toBeVisible()
  const closeButton = appWindow.getByRole('button', {
    name: 'Close expanded preview',
  })
  await expect(closeButton).toBeFocused()

  // Act — collapse via Escape.
  await appWindow.keyboard.press('Escape')

  // Assert — overlay dismissed and focus restored to the expand trigger.
  await expect(dialog).toBeHidden()
  await expect(expandButton).toBeFocused()

  // Assert — the SAME <webview> node survived the round-trip and no reload
  // (did-start-loading) fired while toggling. This is the AC#5 guarantee.
  const probe = await appWindow.evaluate(() => {
    const webview = document.querySelector<HTMLElement>('webview')
    return {
      identity: webview?.dataset.e2eIdentity ?? null,
      loadStarts: webview?.dataset.loadStarts ?? null,
    }
  })
  expect(probe.identity).toBe('preview-node-stable')
  expect(probe.loadStarts).toBe('0')
})

test('Marketplace preview overlay closes on backdrop click and via the close button', async ({
  appWindow,
}) => {
  // Arrange.
  await waitForInitialScan(appWindow)
  const expandButton = await openPreview(appWindow)

  // Act — expand, then click the scrim behind the overlay.
  await expandButton.click()
  const dialog = appWindow.getByRole('dialog', { name: /find-skills preview/i })
  await expect(dialog).toBeVisible()
  await appWindow.evaluate(() => {
    const backdrop = document.querySelector<HTMLElement>(
      '[aria-hidden="true"].fixed.inset-0',
    )
    if (!backdrop) throw new Error('overlay backdrop not rendered')
    backdrop.click()
  })

  // Assert — backdrop click collapses; body scroll-lock is released.
  await expect(dialog).toBeHidden()
  expect(await appWindow.evaluate(() => document.body.style.overflow)).toBe('')

  // Act — expand again and close via the explicit button.
  await expandButton.click()
  await expect(dialog).toBeVisible()
  await appWindow
    .getByRole('button', { name: 'Close expanded preview' })
    .click()

  // Assert.
  await expect(dialog).toBeHidden()
})
