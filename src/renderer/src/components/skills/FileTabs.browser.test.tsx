import * as TabsPrimitive from '@radix-ui/react-tabs'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import type { AbsolutePath, SkillFile } from '@/shared/types'
import '@/renderer/src/styles/globals.css'

import { FileTabs } from './FileTabs'

/**
 * Build a SkillFile fixture without touching the IPC/preload layer.
 * @param overrides - Fields that drive the tab label and icon choice.
 * @returns A SkillFile with sensible defaults for the file tab bar.
 */
function makeSkillFile(overrides: Partial<SkillFile> = {}): SkillFile {
  return {
    name: 'SKILL.md',
    path: '/Users/me/.agents/skills/tdd/SKILL.md',
    relativePath: 'SKILL.md',
    extension: '.md',
    size: 1024,
    previewable: 'text',
    ...overrides,
  }
}

/**
 * Render FileTabs inside the Radix Tabs Root it depends on for context.
 * Mirrors CodePreview's wrapper so List/Trigger get the WAI-ARIA tabs context.
 * @param files - Tabs to render, one per file.
 * @param activeFilePath - Path of the file whose tab is selected, or null.
 * @returns The vitest-browser-react render result.
 */
async function renderFileTabs(
  files: SkillFile[],
  activeFilePath: AbsolutePath | null,
) {
  return render(
    <TabsPrimitive.Root value={activeFilePath ?? ''} onValueChange={() => {}}>
      <FileTabs files={files} activeFilePath={activeFilePath} />
    </TabsPrimitive.Root>,
  )
}

describe('FileTabs tab bar', () => {
  it('renders one tab per file labeled by its relative path', async () => {
    // Arrange
    const files = [
      makeSkillFile({
        path: '/Users/me/.agents/skills/tdd/SKILL.md',
        relativePath: 'SKILL.md',
      }),
      makeSkillFile({
        name: 'run.md',
        path: '/Users/me/.agents/skills/tdd/workflows/run.md',
        relativePath: 'workflows/run.md',
      }),
    ]

    // Act
    const screen = await renderFileTabs(files, files[0].path)

    // Assert: nested entries stay distinguishable by their full relative path.
    await expect
      .element(screen.getByRole('tab', { name: /SKILL\.md/ }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('tab', { name: 'workflows/run.md' }))
      .toBeInTheDocument()
  })

  it('marks the active file as the selected tab', async () => {
    // Arrange
    const files = [
      makeSkillFile({
        path: '/Users/me/.agents/skills/tdd/SKILL.md',
        relativePath: 'SKILL.md',
      }),
      makeSkillFile({
        name: 'helper.py',
        path: '/Users/me/.agents/skills/tdd/lib/helper.py',
        relativePath: 'lib/helper.py',
        extension: '.py',
      }),
    ]

    // Act
    const screen = await renderFileTabs(files, files[1].path)

    // Assert: only the active file's tab reports aria-selected.
    await expect
      .element(screen.getByRole('tab', { name: 'lib/helper.py' }))
      .toHaveAttribute('aria-selected', 'true')
    await expect
      .element(screen.getByRole('tab', { name: /SKILL\.md/ }))
      .toHaveAttribute('aria-selected', 'false')
  })

  it('shows an image icon on tabs for previewable image files', async () => {
    // Arrange
    const files = [
      makeSkillFile({
        name: 'diagram.png',
        path: '/Users/me/.agents/skills/tdd/diagram.png',
        relativePath: 'diagram.png',
        extension: '.png',
        previewable: 'image',
      }),
    ]

    // Act
    const screen = await renderFileTabs(files, null)

    // Assert
    const tab = screen.getByRole('tab', { name: 'diagram.png' }).element()
    expect(tab.querySelector('.lucide-file-image')).toBeInstanceOf(SVGElement)
  })

  it('shows a document icon on tabs for Markdown files', async () => {
    // Arrange
    const files = [
      makeSkillFile({
        name: 'NOTES.mdx',
        path: '/Users/me/.agents/skills/tdd/NOTES.mdx',
        relativePath: 'NOTES.mdx',
        extension: '.mdx',
        previewable: 'text',
      }),
    ]

    // Act
    const screen = await renderFileTabs(files, null)

    // Assert
    const tab = screen.getByRole('tab', { name: 'NOTES.mdx' }).element()
    expect(tab.querySelector('.lucide-file-text')).toBeInstanceOf(SVGElement)
  })

  it('shows a code icon on tabs for other source files', async () => {
    // Arrange
    const files = [
      makeSkillFile({
        name: 'helper.py',
        path: '/Users/me/.agents/skills/tdd/lib/helper.py',
        relativePath: 'lib/helper.py',
        extension: '.py',
        previewable: 'text',
      }),
    ]

    // Act
    const screen = await renderFileTabs(files, null)

    // Assert
    const tab = screen.getByRole('tab', { name: 'lib/helper.py' }).element()
    expect(tab.querySelector('.lucide-file-code')).toBeInstanceOf(SVGElement)
  })
})
