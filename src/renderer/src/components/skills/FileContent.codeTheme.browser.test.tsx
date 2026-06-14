import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import '@/renderer/src/styles/globals.css'

// Mock the Shiki shorthand so this file can assert which theme pair FileContent
// actually hands the highlighter — the one seam (props -> resolveCodeTheme ->
// codeToHtml) that real-Shiki render tests can't observe, since Shiki colours
// aren't assertable in the browser env. vi.hoisted keeps the spy reference safe
// across vi.mock hoisting. Isolated in its own file because vi.mock is
// file-scoped: the sibling FileContent tests need the real transformer output
// (line numbers), which a mocked codeToHtml would strip.
const { mockCodeToHtml } = vi.hoisted(() => ({ mockCodeToHtml: vi.fn() }))

vi.mock('./shikiPreview', () => ({ codeToHtml: mockCodeToHtml }))

/**
 * Build a code-file text preview payload off the IPC layer.
 * @param content - Raw source rendered in the default code view.
 * @returns PreviewContent for FileContent's `text` branch.
 * @example
 * makeCodeContent('const x = 1\n')
 */
function makeCodeContent(content: string): PreviewContent {
  return {
    kind: 'text',
    data: {
      name: 'example.ts',
      content,
      extension: '.ts',
      lineCount: content.split('\n').length,
    },
  }
}

describe('FileContent code theme', () => {
  beforeEach(() => {
    mockCodeToHtml.mockReset()
    mockCodeToHtml.mockResolvedValue(
      '<pre class="shiki"><code><span class="line">code</span></code></pre>',
    )
  })

  it('highlights the code preview using the user-selected theme pair', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')

    // Act — the code view is the default mode, so SyntaxHighlightedCode runs
    // immediately with the non-default 'vitesse' theme.
    await render(
      <FileContent
        content={makeCodeContent('const answer = 42\n')}
        codeThemeId="vitesse"
      />,
    )

    // Assert — the chosen id is resolved to its light/dark pair and forwarded to
    // Shiki, so picking 'vitesse' in Settings actually recolours the preview.
    await expect.poll(() => mockCodeToHtml.mock.calls.length).toBeGreaterThan(0)
    expect(mockCodeToHtml).toHaveBeenCalledWith(
      'const answer = 42\n',
      expect.objectContaining({
        themes: { dark: 'vitesse-dark', light: 'vitesse-light' },
      }),
    )
  })
})
