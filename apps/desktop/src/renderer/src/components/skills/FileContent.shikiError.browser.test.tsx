import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import { createPreferencesFixture } from '@/renderer/src/test-utils/rendererPreferences'
import { getWindowSurfaceStyle } from '@/renderer/src/utils/getWindowSurfaceStyle'
import {
  MARKDOWN_PREVIEW_MODE_KEY,
  RENDERER_PREFERENCES_STORAGE_KEY,
} from '@/shared/constants'
import { toFileExtension, toFileName, toLineCount } from '@/shared/types'
import '@/renderer/src/styles/globals.css'

let fixture: Awaited<ReturnType<typeof createPreferencesFixture>> | undefined

async function render(element: ReactElement) {
  // eslint-disable-next-line require-atomic-updates -- This suite owns one fixture and runs its tests sequentially.
  fixture ??= await createPreferencesFixture()
  return fixture.render(element)
}

async function resetPreferencesFixture(): Promise<void> {
  const previous = fixture
  fixture = undefined
  await previous?.dispose()
}

// Force Shiki to fail so the preview must fall back to the plain-text renderer
// instead of blanking out. Mocked file-wide because vi.mock is hoisted; every
// test here intentionally exercises the highlighter-failure path.
vi.mock('./shikiPreview', () => ({
  codeToHtml: vi.fn(async () => {
    throw new Error('unsupported grammar')
  }),
}))

/**
 * Build a text preview payload off the IPC layer.
 * @param content - Raw source text rendered by the preview.
 * @returns PreviewContent for FileContent's `text` branch.
 */
function makeTextContent(content: string): PreviewContent {
  return {
    kind: 'text',
    data: {
      name: toFileName('mystery.unknownext'),
      content,
      extension: toFileExtension('.unknownext'),
      lineCount: toLineCount(1),
    },
  }
}

describe('FileContent Shiki failure fallback', () => {
  beforeEach(async () => {
    // Shared Chromium origin: a leaked 'reading' mode would mount the Markdown
    // pane instead of the code view under test if a fixture ever goes .md.
    // The Redux store must reset alongside storage.
    window.localStorage.removeItem(MARKDOWN_PREVIEW_MODE_KEY)
    window.localStorage.removeItem(RENDERER_PREFERENCES_STORAGE_KEY)
    await resetPreferencesFixture()
  })

  afterEach(async () => {
    // Symmetric cleanup: a future .md fixture that writes 'reading' must not
    // leak the mode to the next file sharing this Chromium origin.
    window.localStorage.removeItem(MARKDOWN_PREVIEW_MODE_KEY)
    window.localStorage.removeItem(RENDERER_PREFERENCES_STORAGE_KEY)
    await resetPreferencesFixture()
  })

  test('keeps plain-text source opaque under translucent panes when syntax highlighting throws', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')

    // Act
    const screen = await render(
      <div
        data-testid="translucent-pane"
        style={getWindowSurfaceStyle('section', 45, 100)}
      >
        <FileContent
          content={makeTextContent('const unhighlightable = true')}
        />
      </div>,
    )

    // Assert: the source is still readable via the plain-text fallback table,
    // and Shiki's highlighted markup never appears.
    await expect
      .element(screen.getByText('const unhighlightable = true'))
      .toBeVisible()
    await expect
      .poll(() => screen.container.querySelector('.skill-code-preview'))
      .toBeNull()
    const preview = screen.container.querySelector('[data-file-preview-scroll]')
    if (!preview) throw new Error('Missing plain-text preview')
    // Raw Vitest CSS proves inheritance reset; Electron checks compiled background paint.
    expect(
      getComputedStyle(screen.getByTestId('translucent-pane').element())
        .getPropertyValue('--window-surface-opacity')
        .trim(),
    ).toBe('0.45')
    expect(
      getComputedStyle(preview)
        .getPropertyValue('--window-surface-opacity')
        .trim(),
    ).toBe('1')
    expect(
      getComputedStyle(
        screen.getByRole('cell', { name: '1', exact: true }).element(),
      )
        .getPropertyValue('--window-surface-opacity')
        .trim(),
    ).toBe('1')
  })
})
