import { describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import { getWindowSurfaceStyle } from '@/renderer/src/utils/getWindowSurfaceStyle'
import { toFileExtension, toFileName, toLineCount } from '@/shared/types'
import '@/renderer/src/styles/globals.css'

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
