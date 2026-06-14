import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import '@/renderer/src/styles/globals.css'

import * as shikiPreview from './shikiPreview'

// Passthrough spy over the real Shiki highlighter: every test keeps genuine
// highlighting by default, while the file-switch cancellation test uses
// `mockReturnValueOnce` to hang one specific call so a stale rejection can be
// raced against a later file's successful highlight.
vi.mock('./shikiPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof shikiPreview>()
  return { ...actual, codeToHtml: vi.fn(actual.codeToHtml) }
})

/**
 * Build a text preview payload without pulling in the IPC hook.
 * @param overrides - File metadata/content fields relevant to the preview;
 *   `name`/`extension` default to a Markdown file, override them to render a
 *   non-Markdown source file that is always shown in code mode.
 * @returns PreviewContent for FileContent's `text` branch.
 */
function makeTextContent(
  overrides: Partial<{ content: string; name: string; extension: string }> = {},
): PreviewContent {
  const content = 'content' in overrides ? overrides.content : '# Skill\n'
  return {
    kind: 'text',
    data: {
      name: overrides.name ?? 'SKILL.md',
      content: content ?? '# Skill\n',
      extension: overrides.extension ?? '.md',
      lineCount: content?.split('\n').length ?? 1,
    },
  }
}

// 1x1 transparent PNG kept inline so the image branch never touches the IPC layer.
const TRANSPARENT_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/**
 * Build an empty preview payload off the IPC layer.
 * @returns PreviewContent for FileContent's `empty` branch.
 */
function makeEmptyContent(): PreviewContent {
  return { kind: 'empty' }
}

/**
 * Build a binary preview payload off the IPC layer.
 * @param fileName - Display name shown in the placeholder.
 * @param size - File size in bytes for the human-readable size label.
 * @returns PreviewContent for FileContent's `binary` branch.
 */
function makeBinaryContent(fileName: string, size: number): PreviewContent {
  return { kind: 'binary', fileName, size }
}

/**
 * Build an image preview payload off the IPC layer.
 * @param name - Display name used as the `<img>` alt text.
 * @param dataUrl - base64 data URL rendered as the image source.
 * @returns PreviewContent for FileContent's `image` branch.
 */
function makeImageContent(name: string, dataUrl: string): PreviewContent {
  return {
    kind: 'image',
    data: { name, dataUrl, mimeType: 'image/png', size: 70 },
  }
}

describe('FileContent Markdown modes', () => {
  it('renders Markdown files in code mode first, then switches to Reading Mode', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content:
            '---\nname: install\n---\n# Install\n\n- [x] Link agents\n\n```ts\nconst ok = true\n```',
        })}
      />,
    )

    // Assert: code mode is the initial view, so the heading is not rendered yet.
    await expect
      .element(screen.getByRole('radio', { name: /Show Markdown source/i }))
      .toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Install' }).query()).toBeNull()

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'Install' }))
      .toBeInTheDocument()
    await expect.element(screen.getByText('Link agents')).toBeInTheDocument()
    expect(screen.getByText('name: install').query()).toBeNull()
  })

  it('stays in Code mode when the already-selected Code toggle is clicked again', async () => {
    // Arrange — start in Code mode (the default) viewing a Markdown file whose
    // heading only renders once Reading Mode is active.
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content: '# Install\n\nBody copy',
        })}
      />,
    )
    const codeToggle = screen.getByRole('radio', {
      name: /Show Markdown source/i,
    })
    await expect.element(codeToggle).toHaveAttribute('aria-checked', 'true')

    // Act — clicking the active item makes Radix emit an empty string, which
    // the mode guard must ignore so the view does not flip or blank out.
    await codeToggle.click()

    // Assert — still in Code mode: the toggle stays selected, the source-code
    // scroll pane is still mounted, the Reading Mode pane never appears, and the
    // raw Markdown is never rendered as an <h1> heading.
    await expect.element(codeToggle).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.container.querySelector('[data-file-preview-scroll]'),
    ).toBeInstanceOf(HTMLElement)
    expect(
      screen.container.querySelector('[data-markdown-reading-scroll]'),
    ).toBeNull()
    expect(screen.getByRole('heading', { name: 'Install' }).query()).toBeNull()
  })

  it('keeps the new file preview when a previous file highlight rejects after switching files', async () => {
    // Arrange — switch the preview to a different file while the first file's
    // Shiki highlight is still in flight, then make that stale call reject.
    const { FileContent } = await import('./FileContent')
    const mockedCodeToHtml = vi.mocked(shikiPreview.codeToHtml)
    mockedCodeToHtml.mockClear()
    let rejectStaleHighlight: (reason: Error) => void = () => {}
    // The first (file A) highlight hangs until we reject it by hand; later calls
    // fall through to the real Shiki highlighter for file B.
    mockedCodeToHtml.mockReturnValueOnce(
      new Promise<string>((_, reject) => {
        rejectStaleHighlight = reject
      }),
    )
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content: 'const fileA = 1\n',
          name: 'fileA.ts',
          extension: '.ts',
        })}
      />,
    )

    // Act — switch to file B; this cancels file A's in-flight effect and lets
    // the real highlighter resolve file B's source.
    await screen.rerender(
      <FileContent
        content={makeTextContent({
          content: 'const fileB = 2\n',
          name: 'fileB.ts',
          extension: '.ts',
        })}
      />,
    )
    await expect
      .poll(() => screen.container.querySelector('.skill-code-preview'))
      .toBeInstanceOf(HTMLElement)
    await expect
      .element(screen.getByText(/const fileB = 2/))
      .toBeInTheDocument()

    // Reject file A's abandoned highlight now that file B is on screen.
    rejectStaleHighlight(new Error('stale highlight rejected'))
    // Let the rejection's catch handler and any resulting React flush settle so
    // an unguarded `setHighlightedHtml(null)` would have already blanked B.
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => requestAnimationFrame(resolve))

    // Assert — file B's highlighted preview survives: the cancelled rejection
    // never blanks the pane back to the plain-text fallback.
    expect(
      screen.container.querySelector('.skill-code-preview'),
    ).toBeInstanceOf(HTMLElement)
    await expect
      .element(screen.getByText(/const fileB = 2/))
      .toBeInTheDocument()
  })

  it('keeps Markdown that starts with a horizontal rule in Reading Mode', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content: '---\n# Keep Me\n---\n\nVisible body',
        })}
      />,
    )

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'Keep Me' }))
      .toBeInTheDocument()
    await expect.element(screen.getByText('Visible body')).toBeInTheDocument()
  })

  it('renders language-less code fences as block code without AST attributes', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content:
            '# Skill\n\n```\nnpx skills list --json\n```\n\nInline `skill` stays compact.',
        })}
      />,
    )

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert
    const blockCode = screen.getByText(/npx skills list --json/).query()
    const inlineCode = screen.getByText('skill', { exact: true }).query()

    expect(blockCode).toBeInstanceOf(HTMLElement)
    expect(inlineCode).toBeInstanceOf(HTMLElement)
    expect(blockCode?.closest('pre')).toBeInstanceOf(HTMLPreElement)
    expect(inlineCode?.closest('pre')).toBeNull()
    expect(screen.container.querySelector('[node]')).toBeNull()
  })

  it('renders language-tagged code fences as block code', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content: '# Skill\n\n```ts\nconst ok = true\n```',
        })}
      />,
    )

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert
    const blockCode = screen.getByText(/const ok = true/).query()

    expect(blockCode).toBeInstanceOf(HTMLElement)
    expect(blockCode?.closest('pre')).toBeInstanceOf(HTMLPreElement)
  })

  it('locks Reading Mode to vertical scrolling when Markdown is wider than the pane', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const wideInline = 'very-long-inline-token-'.repeat(30)
    const wideBlock = 'wide command '.repeat(40)
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content: `# Wide\n\n\`${wideInline}\`\n\n\`\`\`\n${wideBlock}\n\`\`\``,
        })}
      />,
    )

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert
    const scrollPane = screen.container.querySelector(
      '[data-markdown-reading-scroll]',
    )
    expect(scrollPane).toBeInstanceOf(HTMLElement)
    const pane = scrollPane as HTMLElement

    // Programmatic scroll mirrors trackpad horizontal gestures in the renderer.
    pane.scrollTo({ left: 240 })
    expect(pane.scrollLeft).toBe(0)

    const blockCode = screen.getByText(/wide command/).query()
    expect(blockCode).toBeInstanceOf(HTMLElement)
    const preElement = blockCode?.closest('pre')
    expect(preElement).toBeInstanceOf(HTMLPreElement)
    const scrollContainer = preElement as HTMLPreElement
    scrollContainer.scrollTo({ left: 240 })
    expect(scrollContainer.scrollLeft).toBe(0)
  })

  it('adds a bottom spacer after source code so the final line can breathe', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')

    // Act
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content: Array.from(
            { length: 48 },
            (_, index) => `line ${index + 1}`,
          ).join('\n'),
        })}
      />,
    )

    // Assert
    const scrollPane = screen.container.querySelector(
      '[data-file-preview-scroll]',
    )
    const spacer = screen.container.querySelector(
      '[data-file-preview-bottom-spacer]',
    )

    expect(scrollPane).toBeInstanceOf(HTMLElement)
    expect(spacer).toBeInstanceOf(HTMLElement)
    expect(scrollPane?.lastElementChild).toBe(spacer)
  })

  it('keeps source code line numbers pinned while horizontally scrolling long Markdown source', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const longMarkdownLine = `description: ${'wide-token-'.repeat(80)}`

    // Act
    const screen = await render(
      <>
        <style>{'.markdown-scroll-test > * { min-width: 0; }'}</style>
        <div
          className="markdown-scroll-test"
          style={{ display: 'flex', height: 220, width: 320 }}
        >
          <FileContent
            content={makeTextContent({
              content: `---\nname: wide-skill\n${longMarkdownLine}\n---\n\n# Wide`,
            })}
          />
        </div>
      </>,
    )

    await expect
      .poll(() =>
        screen.container.querySelector('.skill-code-preview .line-number'),
      )
      .toBeInstanceOf(HTMLElement)

    const scrollPane = screen.container.querySelector(
      '[data-file-preview-scroll]',
    )
    expect(scrollPane).toBeInstanceOf(HTMLElement)
    const scrollPaneElement = scrollPane as HTMLElement

    await expect
      .poll(() => scrollPaneElement.scrollWidth > scrollPaneElement.clientWidth)
      .toBe(true)

    // Assert
    const lineNumber = screen.container.querySelector(
      '.skill-code-preview .line-number',
    )
    expect(lineNumber).toBeInstanceOf(HTMLElement)
    const lineNumberElement = lineNumber as HTMLElement
    const lineNumberStyle = window.getComputedStyle(lineNumberElement)
    expect(lineNumberStyle.position).toBe('sticky')
    expect(lineNumberStyle.left).toBe('0px')

    const initialLineNumberLeft = Math.round(
      lineNumberElement.getBoundingClientRect().left,
    )
    scrollPaneElement.scrollLeft = 240

    await expect.poll(() => scrollPaneElement.scrollLeft > 0).toBe(true)
    await expect
      .poll(() => Math.round(lineNumberElement.getBoundingClientRect().left))
      .toBe(initialLineNumberLeft)
  })
})

describe('FileContent preview kinds', () => {
  it('prompts the user to pick a file when nothing is selected', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')

    // Act
    const screen = await render(<FileContent content={makeEmptyContent()} />)

    // Assert
    await expect
      .element(screen.getByText('Select a file to preview'))
      .toBeInTheDocument()
  })

  it('explains that a binary file cannot be previewed and shows its size', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')

    // Act
    const screen = await render(
      <FileContent content={makeBinaryContent('archive.zip', 2048)} />,
    )

    // Assert
    await expect.element(screen.getByText('archive.zip')).toBeInTheDocument()
    await expect
      .element(screen.getByText(/Cannot preview binary or oversized file/))
      .toBeInTheDocument()
    await expect.element(screen.getByText('2.0 KB')).toBeInTheDocument()
  })

  it('shows the image itself when previewing an image file', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')

    // Act
    const screen = await render(
      <FileContent
        content={makeImageContent('preview.png', TRANSPARENT_PNG_DATA_URL)}
      />,
    )

    // Assert
    const image = screen.getByRole('img', { name: 'preview.png' })
    await expect.element(image).toBeInTheDocument()
    await expect.element(image).toHaveAttribute('src', TRANSPARENT_PNG_DATA_URL)
  })
})

describe('FileContent Reading Mode element styling', () => {
  it('opens Markdown links in a new tab safely', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content: '# Skill\n\n[Docs](https://example.com/docs)',
        })}
      />,
    )

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert
    const link = screen.getByRole('link', { name: 'Docs' })
    await expect.element(link).toBeInTheDocument()
    await expect
      .element(link)
      .toHaveAttribute('href', 'https://example.com/docs')
    await expect.element(link).toHaveAttribute('target', '_blank')
    await expect.element(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('renders Markdown blockquotes as quoted callouts', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content: '# Skill\n\n> Heed this warning',
        })}
      />,
    )

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert
    const quote = screen.getByText('Heed this warning').query()
    expect(quote?.closest('blockquote')).toBeInstanceOf(HTMLQuoteElement)
  })

  it('renders Markdown section and subsection headings as h2 and h3', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content: '# Title\n\n## Section Two\n\n### Section Three',
        })}
      />,
    )

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert
    await expect
      .element(screen.getByRole('heading', { level: 2, name: 'Section Two' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('heading', { level: 3, name: 'Section Three' }))
      .toBeInTheDocument()
  })

  it('renders ordered Markdown lists as numbered lists', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content: '# Skill\n\n1. First step\n2. Second step',
        })}
      />,
    )

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert
    const firstItem = screen.getByText('First step').query()
    expect(firstItem?.closest('ol')).toBeInstanceOf(HTMLOListElement)
  })

  it('renders GitHub Flavored Markdown tables with header and body cells', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content:
            '# Skill\n\n| Agent | Status |\n| --- | --- |\n| Claude | valid |',
        })}
      />,
    )

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert: header cell renders as a <th>, body cell as a <td>.
    const headerCell = screen.getByText('Agent').query()
    const bodyCell = screen.getByText('Claude').query()
    expect(headerCell?.closest('th')).toBeInstanceOf(HTMLTableCellElement)
    expect(bodyCell?.closest('td')).toBeInstanceOf(HTMLTableCellElement)
    expect(headerCell?.closest('table')).toBeInstanceOf(HTMLTableElement)
  })
})

describe('FileContent preview typography scaling', () => {
  it('renders the Markdown reading view at the configured body font size', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({ content: '# Title\n\nBody text' })}
        markdownFontSizePx={18}
      />,
    )

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert — the reading article is the scale anchor: its inline font size
    // matches the configured body size exactly.
    const article = screen.container.querySelector('.markdown-reading-prose')
    expect(article).toBeInstanceOf(HTMLElement)
    expect((article as HTMLElement).style.fontSize).toBe('18px')
  })

  it('renders the code view at the configured code font size', async () => {
    // Arrange — default mode is code, so the syntax-highlighted view shows
    // first; its scroll root carries the configured inline font size whether
    // Shiki has resolved (div) or the plain-text fallback (table) is showing.
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({ content: 'const answer = 42\n' })}
        codeFontSizePx={16}
      />,
    )

    // Act
    const scrollPane = screen.container.querySelector(
      '[data-file-preview-scroll]',
    )
    expect(scrollPane).toBeInstanceOf(HTMLElement)

    // Assert
    await expect
      .poll(() => {
        const root = (scrollPane as HTMLElement).firstElementChild
        return root instanceof HTMLElement ? root.style.fontSize : null
      })
      .toBe('16px')
  })
})
