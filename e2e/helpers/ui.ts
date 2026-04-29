import type { Page } from '@playwright/test'

/**
 * Click the row for a skill by visible name. Uses role/aria-label so it
 * stays aligned with the project's existing selector convention (~72
 * aria-label uses vs 1 data-testid). Pass an exact name; substring matches
 * trip on similarly-named skills (azure-ai vs azure-ai-extra).
 */
export async function selectSkillByName(
  page: Page,
  name: string,
): Promise<void> {
  await page
    .getByRole('button', { name: new RegExp(`^${escapeRegex(name)}$`, 'i') })
    .first()
    .click()
}

/** Toggle the row checkbox for each name to build a bulk selection. */
export async function bulkSelect(page: Page, names: string[]): Promise<void> {
  for (const name of names) {
    await page
      .getByRole('checkbox', { name: new RegExp(escapeRegex(name), 'i') })
      .first()
      .click()
  }
}

/** Click the "Delete selected" toolbar button (visible only when selection.length > 0). */
export async function clickDeleteSelected(page: Page): Promise<void> {
  await page.getByRole('button', { name: /delete selected/i }).click()
}

/**
 * Click the Undo button on the most recent sonner toast. Toast lives 15s
 * by design — call within ~5s to stay safely inside the window.
 */
export async function clickUndoToast(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^undo$/i }).click()
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
