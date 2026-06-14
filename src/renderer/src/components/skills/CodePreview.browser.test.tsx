import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'
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

/**
 * Render CodePreview inside a settings-preloaded Redux Provider. CodePreview
 * reads the preview-typography settings via `useAppSelector`, so every render
 * needs a store; `overrides` preloads non-default appearance values.
 * @param overrides - Settings fields that differ from DEFAULT_SETTINGS.
 * @returns The vitest-browser-react render result.
 * @example
 * await renderCodePreview({ codeFontSizePx: 16 })
 */
async function renderCodePreview(overrides: Partial<Settings> = {}) {
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  const store = configureStore({
    reducer: { settings: settingsReducer },
    preloadedState: { settings: { ...DEFAULT_SETTINGS, ...overrides } },
  })
  const { CodePreview } = await import('./CodePreview')
  return render(
    <Provider store={store}>
      <CodePreview skillPath={SKILL_PATH} />
    </Provider>,
  )
}

describe('CodePreview', () => {
  beforeEach(() => {
    mockUseCodePreview.mockReset()
  })

  it('shows a loading placeholder while the file list is still being fetched', async () => {
    // Arrange
    mockUseCodePreview.mockReturnValue(makeHookReturn({ loading: true }))

    // Act
    const screen = await renderCodePreview()

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

    // Act
    const screen = await renderCodePreview()

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

    // Act
    const screen = await renderCodePreview()

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
    const screen = await renderCodePreview()

    // Act
    await screen.getByRole('tab', { name: /README\.md/ }).click()

    // Assert
    expect(setActiveFileSpy).toHaveBeenCalledWith(readmeFile.path)
  })

  it('renders the code preview at the user-configured code font size from settings', async () => {
    // Arrange — the Redux→props seam: a non-default codeFontSizePx persisted in
    // settings must flow through CodePreview into FileContent's code root.
    const skillFile = makeFile()
    mockUseCodePreview.mockReturnValue(
      makeHookReturn({
        files: [skillFile],
        activeFile: skillFile.path,
        content: {
          kind: 'text',
          data: {
            name: 'SKILL.md',
            content: 'const answer = 42\n',
            extension: '.md',
            lineCount: 1,
          },
        },
      }),
    )

    // Act
    const screen = await renderCodePreview({ codeFontSizePx: 16 })

    // Assert — the code scroll root (Shiki div or plain-text fallback table)
    // carries the configured 16px inline font size.
    const scrollPane = screen.container.querySelector(
      '[data-file-preview-scroll]',
    )
    expect(scrollPane).toBeInstanceOf(HTMLElement)
    await expect
      .poll(() =>
        (scrollPane as HTMLElement).firstElementChild instanceof HTMLElement
          ? ((scrollPane as HTMLElement).firstElementChild as HTMLElement).style
              .fontSize
          : null,
      )
      .toBe('16px')
  })
})
