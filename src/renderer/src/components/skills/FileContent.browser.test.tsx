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
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content:
            '---\nname: install\n---\n# Install\n\n- [x] Link agents\n\n```ts\nconst ok = true\n```',
        })}
      />,
    )

    await expect
      .element(screen.getByRole('radio', { name: /Show Markdown source/i }))
      .toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Install' }).query()).toBeNull()

    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    await expect
      .element(screen.getByRole('heading', { name: 'Install' }))
      .toBeInTheDocument()
    await expect.element(screen.getByText('Link agents')).toBeInTheDocument()
    expect(screen.getByText('name: install').query()).toBeNull()
  })

  it('keeps Markdown that starts with a horizontal rule in Reading Mode', async () => {
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent
        content={makeTextContent({
          content: '---\n# Keep Me\n---\n\nVisible body',
        })}
      />,
    )

    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    await expect
      .element(screen.getByRole('heading', { name: 'Keep Me' }))
      .toBeInTheDocument()
    await expect.element(screen.getByText('Visible body')).toBeInTheDocument()
  })

  it('adds a bottom spacer after source code so the final line can breathe', async () => {
    const { FileContent } = await import('./FileContent')
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
