import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
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
      name: 'mystery.unknownext',
      content,
      extension: '.unknownext',
      lineCount: 1,
    },
  }
}

describe('FileContent Shiki failure fallback', () => {
  it('shows plain-text source when syntax highlighting throws', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')

    // Act
    const screen = await render(
      <FileContent content={makeTextContent('const unhighlightable = true')} />,
    )

    // Assert: the source is still readable via the plain-text fallback table,
    // and Shiki's highlighted markup never appears.
    await expect
      .element(screen.getByText('const unhighlightable = true'))
      .toBeInTheDocument()
    await expect
      .poll(() => screen.container.querySelector('.skill-code-preview'))
      .toBeNull()
  })
})
