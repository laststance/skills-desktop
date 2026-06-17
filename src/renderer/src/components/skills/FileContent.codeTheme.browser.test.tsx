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

  it('keeps the previous colored output mounted during a theme-only switch, never flashing plain text', async () => {
    // Arrange — the first highlight resolves with a recognizable theme-A marker.
    const { FileContent } = await import('./FileContent')
    mockCodeToHtml.mockResolvedValueOnce(
      '<pre class="shiki"><code><span class="line">THEME_A_COLORED</span></code></pre>',
    )
    const screen = await render(
      <FileContent
        content={makeCodeContent('const x = 1\n')}
        codeThemeId="github"
      />,
    )
    await expect
      .element(screen.getByText('THEME_A_COLORED'))
      .toBeInTheDocument()

    // The theme-B highlight hangs until resolved by hand, so the pane can be
    // observed WHILE the new theme is still resolving.
    let resolveThemeB: (html: string) => void = () => {}
    mockCodeToHtml.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveThemeB = resolve
      }),
    )

    // Act — switch ONLY the theme; content and language are identical.
    await screen.rerender(
      <FileContent
        content={makeCodeContent('const x = 1\n')}
        codeThemeId="vitesse"
      />,
    )
    // Let the effect and any React flush settle, so an unguarded
    // setHighlightedHtml(null) would already have blanked the pane to plain text.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => requestAnimationFrame(resolve))

    // Assert — theme A's colored output is STILL mounted and the plain-text
    // fallback table never appeared mid-swap (the FOUC guard for #221).
    await expect
      .element(screen.getByText('THEME_A_COLORED'))
      .toBeInTheDocument()
    expect(screen.container.querySelector('table')).toBeNull()

    // Resolving theme B swaps colored -> colored with no intervening plain frame.
    resolveThemeB(
      '<pre class="shiki"><code><span class="line">THEME_B_COLORED</span></code></pre>',
    )
    await expect
      .element(screen.getByText('THEME_B_COLORED'))
      .toBeInTheDocument()
  })

  it('falls back to plain text while re-highlighting after a file switch, never bleeding the previous colors', async () => {
    // Arrange — file A highlights with a recognizable marker.
    const { FileContent } = await import('./FileContent')
    mockCodeToHtml.mockResolvedValueOnce(
      '<pre class="shiki"><code><span class="line">FILE_A_COLORED</span></code></pre>',
    )
    const screen = await render(
      <FileContent
        content={makeCodeContent('const fileA = 1\n')}
        codeThemeId="vitesse"
      />,
    )
    await expect.element(screen.getByText('FILE_A_COLORED')).toBeInTheDocument()

    // File B's highlight hangs so the pane can be observed mid-switch.
    let resolveFileB: (html: string) => void = () => {}
    mockCodeToHtml.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveFileB = resolve
      }),
    )

    // Act — switch to a DIFFERENT file (content changes, theme unchanged).
    await screen.rerender(
      <FileContent
        content={makeCodeContent('const fileB = 2\n')}
        codeThemeId="vitesse"
      />,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => requestAnimationFrame(resolve))

    // Assert — file A's colors are gone (no stale bleed) and file B's source is
    // shown via the plain-text fallback while Shiki re-highlights.
    expect(screen.container.querySelector('.skill-code-preview')).toBeNull()
    expect(screen.container.querySelector('table')).toBeInstanceOf(HTMLElement)
    await expect
      .element(screen.getByText(/const fileB = 2/))
      .toBeInTheDocument()

    // Resolving file B installs its colored output.
    resolveFileB(
      '<pre class="shiki"><code><span class="line">FILE_B_COLORED</span></code></pre>',
    )
    await expect.element(screen.getByText('FILE_B_COLORED')).toBeInTheDocument()
  })
})
