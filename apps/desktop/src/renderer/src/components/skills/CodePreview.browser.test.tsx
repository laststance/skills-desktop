import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import { MARKDOWN_PREVIEW_MODE_KEY } from '@/shared/constants'
import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'
import type { AbsolutePath, SkillFile } from '@/shared/types'
import {
  toAbsolutePath,
  toFileExtension,
  toFileName,
  toFileSizeBytes,
  toLineCount,
  toPosixRelativePath,
} from '@/shared/types'
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
    name: toFileName('SKILL.md'),
    path: toAbsolutePath(`${SKILL_PATH}/SKILL.md`),
    relativePath: toPosixRelativePath('SKILL.md'),
    extension: toFileExtension('.md'),
    size: toFileSizeBytes(1024),
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
  loadFailed?: boolean
  setActiveFile?: (path: AbsolutePath | null) => Promise<void>
}) {
  return {
    files: overrides.files ?? [],
    activeFile: overrides.activeFile ?? null,
    setActiveFile: overrides.setActiveFile ?? vi.fn(),
    content: overrides.content ?? { kind: 'empty' },
    loading: overrides.loading ?? false,
    loadFailed: overrides.loadFailed ?? false,
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
      <CodePreview skillPath={toAbsolutePath(SKILL_PATH)} />
    </Provider>,
  )
}

describe('CodePreview', () => {
  beforeEach(() => {
    mockUseCodePreview.mockReset()
    // Browser-mode files share one Chromium origin: clear the persisted preview
    // mode so a Reading Mode selection can't leak into tests expecting Code.
    window.localStorage.removeItem(MARKDOWN_PREVIEW_MODE_KEY)
  })

  test('shows a loading placeholder while the file list is still being fetched', async () => {
    // Arrange
    mockUseCodePreview.mockReturnValue(makeHookReturn({ loading: true }))

    // Act
    const screen = await renderCodePreview()

    // Assert
    await expect
      .element(screen.getByText('Loading files...'))
      .toBeInTheDocument()
  })

  test('tells the user no previewable files exist when the skill has none', async () => {
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

  test('explains an unreadable folder instead of claiming the skill has no files', async () => {
    // Arrange -- a failed list leaves `files` empty, so this must not be
    // mistaken for the ordinary "no previewable files" empty state.
    mockUseCodePreview.mockReturnValue(
      makeHookReturn({ loading: false, files: [], loadFailed: true }),
    )

    // Act
    const screen = await renderCodePreview()

    // Assert
    await expect
      .element(screen.getByText("Cannot read this skill's files"))
      .toBeInTheDocument()
    expect(
      screen.container.textContent?.includes('No preview files found'),
    ).toBe(false)
  })

  test('renders a tab for every previewable file once the list has loaded', async () => {
    // Arrange
    const skillFile = makeFile()
    const readmeFile = makeFile({
      name: toFileName('README.md'),
      path: toAbsolutePath(`${SKILL_PATH}/README.md`),
      relativePath: toPosixRelativePath('README.md'),
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

  test('requests the newly selected file when a different tab is clicked', async () => {
    // Arrange
    const setActiveFileSpy = vi.fn(async () => {})
    const skillFile = makeFile()
    const readmeFile = makeFile({
      name: toFileName('README.md'),
      path: toAbsolutePath(`${SKILL_PATH}/README.md`),
      relativePath: toPosixRelativePath('README.md'),
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

  test('resets Reading Mode scroll when the active file switches between same-named Markdown files', async () => {
    // Arrange — two nested files share the basename README.md; only the
    // absolute path CodePreview passes to FileContent (filePath) tells them
    // apart, so this seam test fails iff that prop is dropped at the call site.
    const docsReadme = makeFile({
      name: toFileName('README.md'),
      path: toAbsolutePath(`${SKILL_PATH}/docs/README.md`),
      relativePath: toPosixRelativePath('docs/README.md'),
    })
    const guideReadme = makeFile({
      name: toFileName('README.md'),
      path: toAbsolutePath(`${SKILL_PATH}/guide/README.md`),
      relativePath: toPosixRelativePath('guide/README.md'),
    })
    const readmeContent = (heading: string): PreviewContent => ({
      kind: 'text',
      data: {
        name: toFileName('README.md'),
        content: `# ${heading}\n\n${'line\n'.repeat(200)}`,
        extension: toFileExtension('.md'),
        lineCount: toLineCount(202),
      },
    })
    mockUseCodePreview.mockReturnValue(
      makeHookReturn({
        files: [docsReadme, guideReadme],
        activeFile: docsReadme.path,
        content: readmeContent('First'),
      }),
    )
    const { default: settingsReducer } =
      await import('@/renderer/src/redux/slices/settingsSlice')
    const store = configureStore({
      reducer: { settings: settingsReducer },
      preloadedState: { settings: DEFAULT_SETTINGS },
    })
    const { CodePreview } = await import('./CodePreview')
    // The fixed-height flex wrapper bounds the preview pane so the reading
    // scroll container actually overflows; without it scrollTop clamps to 0
    // and the reset assertion below would pass vacuously. `tree` is a factory,
    // not a shared element: passing the same element object to rerender is a
    // no-op, so each call must build a fresh tree to flush the new mock data.
    const tree = (
      <div style={{ display: 'flex', height: 220 }}>
        <Provider store={store}>
          <CodePreview skillPath={toAbsolutePath(SKILL_PATH)} />
        </Provider>
      </div>
    )
    const tree2 = (
      <div style={{ display: 'flex', height: 220 }}>
        <Provider store={store}>
          <CodePreview skillPath={toAbsolutePath(SKILL_PATH)} />
        </Provider>
      </div>
    )
    const screen = await render(tree)
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()
    const firstPane = document.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    if (!firstPane)
      throw new Error('expected a markdown reading scroll container')
    firstPane.scrollTop = 1200
    expect(firstPane.scrollTop).toBeGreaterThan(0)

    // Act — the hook now reports the other README.md as the active file.
    mockUseCodePreview.mockReturnValue(
      makeHookReturn({
        files: [docsReadme, guideReadme],
        activeFile: guideReadme.path,
        content: readmeContent('Second'),
      }),
    )
    await screen.rerender(tree2)

    // Assert — the second file's pane remounted at the top. If CodePreview
    // stops passing filePath, both files key as 'README.md' and the stale
    // offset survives.
    await expect
      .element(screen.getByRole('heading', { name: 'Second' }))
      .toBeVisible()
    const secondPane = document.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    expect(secondPane?.scrollTop).toBe(0)
  })

  test('renders the code preview at the user-configured code font size from settings', async () => {
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
            name: toFileName('SKILL.md'),
            content: 'const answer = 42\n',
            extension: toFileExtension('.md'),
            lineCount: toLineCount(1),
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
