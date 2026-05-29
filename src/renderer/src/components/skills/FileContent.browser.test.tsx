import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'

/**
 * Build a text preview payload without pulling in the IPC hook.
 * @param overrides - File metadata/content fields relevant to the preview.
 * @returns PreviewContent for FileContent's `text` branch.
 */
function makeTextContent(
  overrides: Partial<PreviewContent & { content: string }> = {},
): PreviewContent {
  const content = 'content' in overrides ? overrides.content : '# Skill\n'
  return {
    kind: 'text',
    data: {
      name: 'SKILL.md',
      content: content ?? '# Skill\n',
      extension: '.md',
      lineCount: content?.split('\n').length ?? 1,
    },
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
    expect(pane.scrollWidth).toBeGreaterThan(pane.clientWidth)
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
})
