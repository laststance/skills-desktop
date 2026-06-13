import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import type { AbsolutePath, SkillFile } from '@/shared/types'
import '@/renderer/src/styles/globals.css'

// Mock the data hook so each render deterministically drives loading / empty /
// populated states. Hitting these through real IPC is racy because the hook's
// load effect resolves synchronously in tests, so the loading branch never
// renders. vi.hoisted keeps the spy reference safe across vi.mock hoisting.
const { mockUseCodePreview } = vi.hoisted(() => ({
  mockUseCodePreview: vi.fn(),
}))

vi.mock('@/renderer/src/hooks/useCodePreview', () => ({
  useCodePreview: mockUseCodePreview,
}))

const SKILL_PATH = '/home/user/.agents/skills/tdd'

/**
 * Build a previewable skill file fixture for the tab list.
 * @param overrides - File fields that differ from a root-level SKILL.md.
 * @returns Complete SkillFile object.
 * @example
 * makeFile({ name: 'helper.py', relativePath: 'lib/helper.py', extension: '.py' })
 */
function makeFile(overrides: Partial<SkillFile> = {}): SkillFile {
  return {
    name: 'SKILL.md',
    path: `${SKILL_PATH}/SKILL.md`,
    relativePath: 'SKILL.md',
    extension: '.md',
    size: 1024,
    previewable: 'text',
    ...overrides,
  }
}

/**
 * Build the value returned by the mocked useCodePreview hook for one render.
 * @param overrides - Hook return fields that differ from the populated default.
 * @returns Mock return matching UseCodePreviewReturn's runtime shape.
 */
function makeHookReturn(overrides: {
  files?: SkillFile[]
  activeFile?: AbsolutePath | null
  content?: PreviewContent
  loading?: boolean
  setActiveFile?: (path: AbsolutePath | null) => Promise<void>
}) {
  return {
    files: overrides.files ?? [],
    activeFile: overrides.activeFile ?? null,
    setActiveFile: overrides.setActiveFile ?? vi.fn(),
    content: overrides.content ?? { kind: 'empty' },
    loading: overrides.loading ?? false,
  }
}

describe('CodePreview', () => {
  beforeEach(() => {
    mockUseCodePreview.mockReset()
  })

  it('shows a loading placeholder while the file list is still being fetched', async () => {
    // Arrange
    mockUseCodePreview.mockReturnValue(makeHookReturn({ loading: true }))
    const { CodePreview } = await import('./CodePreview')

    // Act
    const screen = await render(<CodePreview skillPath={SKILL_PATH} />)

    // Assert
    await expect
      .element(screen.getByText('Loading files...'))
      .toBeInTheDocument()
  })

  it('tells the user no previewable files exist when the skill has none', async () => {
    // Arrange
    mockUseCodePreview.mockReturnValue(
      makeHookReturn({ loading: false, files: [] }),
    )
    const { CodePreview } = await import('./CodePreview')

    // Act
    const screen = await render(<CodePreview skillPath={SKILL_PATH} />)

    // Assert
    await expect
      .element(screen.getByText('No preview files found'))
      .toBeInTheDocument()
  })

  it('renders a tab for every previewable file once the list has loaded', async () => {
    // Arrange
    const skillFile = makeFile()
    const readmeFile = makeFile({
      name: 'README.md',
      path: `${SKILL_PATH}/README.md`,
      relativePath: 'README.md',
    })
    mockUseCodePreview.mockReturnValue(
      makeHookReturn({
        files: [skillFile, readmeFile],
        activeFile: skillFile.path,
        content: { kind: 'empty' },
      }),
    )
    const { CodePreview } = await import('./CodePreview')

    // Act
    const screen = await render(<CodePreview skillPath={SKILL_PATH} />)

    // Assert
    await expect
      .element(screen.getByRole('tab', { name: /SKILL\.md/ }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('tab', { name: /README\.md/ }))
      .toBeInTheDocument()
  })

  it('requests the newly selected file when a different tab is clicked', async () => {
    // Arrange
    const setActiveFileSpy = vi.fn(async () => {})
    const skillFile = makeFile()
    const readmeFile = makeFile({
      name: 'README.md',
      path: `${SKILL_PATH}/README.md`,
      relativePath: 'README.md',
    })
    mockUseCodePreview.mockReturnValue(
      makeHookReturn({
        files: [skillFile, readmeFile],
        activeFile: skillFile.path,
        content: { kind: 'empty' },
        setActiveFile: setActiveFileSpy,
      }),
    )
    const { CodePreview } = await import('./CodePreview')
    const screen = await render(<CodePreview skillPath={SKILL_PATH} />)

    // Act
    await screen.getByRole('tab', { name: /README\.md/ }).click()

    // Assert
    expect(setActiveFileSpy).toHaveBeenCalledWith(readmeFile.path)
  })
})
