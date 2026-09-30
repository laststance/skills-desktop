import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import '@/renderer/src/styles/globals.css'
import { MARKDOWN_PREVIEW_MODE_KEY } from '@/shared/constants'
import {
  toAbsolutePath,
  toDataUrl,
  toFileExtension,
  toFileName,
  toFileSizeBytes,
  toLineCount,
  toMimeType,
} from '@/shared/types'

import * as shikiPreview from './shikiPreview'

// The Markdown preview mode toggle persists to real localStorage; reset it so
// one test's selection can't leak into the next test's default-mode assertions.
beforeEach(() => {
  window.localStorage.removeItem(MARKDOWN_PREVIEW_MODE_KEY)
})

// A Storage spy left in place by a failed assertion (before its mockRestore()
// call) would leak into the next test, so restore unconditionally here too.
// restoreAllMocks() only reverts vi.spyOn spies; it doesn't clear the
// passthrough codeToHtml mock's queued mockReturnValueOnce, so a test that
// fails before consuming its queued hang would otherwise leak it forward.
// mockReset (not mockClear) is required: mockClear only empties call history —
// the once-queue survives it — while reset also drains it and restores the
// passthrough implementation for a `vi.fn(impl)` mock.
afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(shikiPreview.codeToHtml).mockReset()
  // Exit storage-clean too: browser-mode files share one Chromium origin, so a
  // persisted mode left by the last test would leak into the next file.
  window.localStorage.removeItem(MARKDOWN_PREVIEW_MODE_KEY)
})

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
  const content = overrides.content ?? '# Skill\n'
  return {
    kind: 'text',
    data: {
      name: toFileName(overrides.name ?? 'SKILL.md'),
      content,
      extension: toFileExtension(overrides.extension ?? '.md'),
      lineCount: toLineCount(content.split('\n').length),
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
  return {
    kind: 'binary',
    fileName: toFileName(fileName),
    size: toFileSizeBytes(size),
  }
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
    data: {
      name: toFileName(name),
      dataUrl: toDataUrl(dataUrl),
      mimeType: toMimeType('image/png'),
      size: toFileSizeBytes(70),
    },
  }
}

describe('FileContent Markdown modes', () => {
  test('renders Markdown files in code mode first, then switches to Reading Mode', async () => {
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

  test('stays in Code mode when the already-selected Code toggle is clicked again', async () => {
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
    // SegmentedControl's value-change guard must ignore so the view does not
    // flip or blank out (the guard lives in segmented-control.tsx, not here).
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

  test('keeps Reading Mode selected when switching to another Markdown file', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent content={makeTextContent({ content: '# First\n' })} />,
    )
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()
    await expect
      .element(screen.getByRole('heading', { name: 'First' }))
      .toBeVisible()

    // Act
    await screen.rerender(
      <FileContent
        content={makeTextContent({ content: '# Second\n', name: 'README.md' })}
      />,
    )

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'Second' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('radio', { name: /Show rendered Markdown/i }))
      .toHaveAttribute('aria-checked', 'true')
  })

  test('restores Reading Mode when switching away to a non-Markdown file and back', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent content={makeTextContent({ content: '# First\n' })} />,
    )
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()
    await expect
      .element(screen.getByRole('heading', { name: 'First' }))
      .toBeVisible()

    // Act — switch to a non-Markdown file: the toggle must disappear entirely.
    await screen.rerender(
      <FileContent
        content={makeTextContent({
          content: 'const ok = true\n',
          name: 'index.ts',
          extension: '.ts',
        })}
      />,
    )

    // Assert
    await expect
      .element(
        screen.getByRole('radiogroup', { name: /Markdown preview mode/i }),
      )
      .not.toBeInTheDocument()

    // Act — switch back to a Markdown file.
    await screen.rerender(
      <FileContent content={makeTextContent({ content: '# First\n' })} />,
    )

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'First' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('radio', { name: /Show rendered Markdown/i }))
      .toHaveAttribute('aria-checked', 'true')
  })

  // Value: protects=switching to a differently-named Markdown file in Reading Mode starts at the top; fails_when=key={file.name} is removed or the scroll container stops remounting on file change; why_new=mode persistence removed the mode-reset remount that used to mask this; seam=none
  test('resets Reading Mode scroll position when switching to another Markdown file', async () => {
    // Arrange — the fixed-height flex wrapper bounds the preview pane so the
    // reading scroll container actually overflows; without it the page grows
    // instead and scrollTop clamps to 0, making the reset assertion vacuous.
    // The second file stays long too, so a stale offset would remain
    // clamped-valid and only a real remount can satisfy the assertion.
    const { FileContent } = await import('./FileContent')
    const longContent = (heading: string): string =>
      `# ${heading}\n\n${'line\n'.repeat(200)}`
    const screen = await render(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          content={makeTextContent({
            content: longContent('First'),
            name: 'FIRST.md',
          })}
        />
      </div>,
    )
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()
    const firstScrollContainer = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    if (!firstScrollContainer) {
      throw new Error('expected a markdown reading scroll container')
    }
    firstScrollContainer.scrollTop = 1200
    // Guard the Arrange: if the pane ever stops overflowing, fail loudly here
    // rather than letting the reset assertion below pass on a 0 default.
    expect(firstScrollContainer.scrollTop).toBeGreaterThan(0)

    // Act — switch to a different Markdown file while still in Reading Mode.
    await screen.rerender(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          content={makeTextContent({
            content: longContent('Second'),
            name: 'SECOND.md',
          })}
        />
      </div>,
    )

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'Second' }))
      .toBeVisible()
    const secondScrollContainer = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    expect(secondScrollContainer?.scrollTop).toBe(0)
  })

  // Value: protects=Reading Mode starts every switched-to Markdown file scrolled to top; fails_when=the key loses its filePath segment (prop dropped, or key regresses to basename+shape), so same-basename nested files with identically-shaped content never remount and keep stale scroll; why_new=the Alpha/Omega fixtures share lineCount AND content.length, making filePath the only differing key segment — weaker fixture shapes pass even without the prop; seam=none
  test('resets Reading Mode scroll position when switching between Markdown files that share a name', async () => {
    // Arrange — a skill's nested directories can hold different Markdown files
    // with the same basename; both load with file.name === 'README.md'. The
    // Alpha/Omega headings are the SAME length, so the two documents share
    // lineCount and content.length and filePath is the only key segment telling
    // them apart — this is what keeps the prop load-bearing in this suite.
    // The fixed-height flex wrapper bounds the preview pane so the scroll
    // container actually overflows, and the second file stays long so a stale
    // offset remains clamped-valid — only a real remount satisfies the assert.
    const { FileContent } = await import('./FileContent')
    const longContent = (heading: string): string =>
      `# ${heading}\n\n${'line\n'.repeat(200)}`
    const screen = await render(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          filePath={toAbsolutePath('/skills/tdd/docs/README.md')}
          content={makeTextContent({
            content: longContent('Alpha'),
            name: 'README.md',
          })}
        />
      </div>,
    )
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()
    const firstScrollContainer = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    if (!firstScrollContainer) {
      throw new Error('expected a markdown reading scroll container')
    }
    firstScrollContainer.scrollTop = 1200
    // Guard the Arrange: if the pane ever stops overflowing, fail loudly here
    // rather than letting the reset assertion below pass on a 0 default.
    expect(firstScrollContainer.scrollTop).toBeGreaterThan(0)

    // Act — switch to a different Markdown file that shares the basename.
    await screen.rerender(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          filePath={toAbsolutePath('/skills/tdd/guide/README.md')}
          content={makeTextContent({
            content: longContent('Omega'),
            name: 'README.md',
          })}
        />
      </div>,
    )

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'Omega' }))
      .toBeVisible()
    const secondScrollContainer = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    expect(secondScrollContainer?.scrollTop).toBe(0)
  })

  // Value: protects=a file switch during a slow content read still opens the new file at top; fails_when=the key loses its content-identity segment (lineCount/content.length), so scroll accrued on the stale document survives into the arriving file; why_new=useCodePreview commits the new path one IPC read before the new content lands — selection-time and commit-time are two separate moments and only a document-identity key resets at the second one; seam=none
  test('resets Reading Mode scroll again when the new file content lands after a stale-content window', async () => {
    // Arrange — mimic useCodePreview's two-step commit: activeFile flips first,
    // then the IPC read resolves the new content. Between them the pane still
    // shows the PREVIOUS document under the NEW path.
    const { FileContent } = await import('./FileContent')
    const first = `# First\n\n${'line\n'.repeat(200)}`
    const second = `# Second\n\n${'row\n'.repeat(300)}`
    const screen = await render(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          filePath={toAbsolutePath('/skills/tdd/docs/README.md')}
          content={makeTextContent({ content: first, name: 'README.md' })}
        />
      </div>,
    )
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()
    const initialPane = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    if (!initialPane)
      throw new Error('expected a markdown reading scroll container')

    // Act — selection committed: new path, stale content still on screen.
    await screen.rerender(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          filePath={toAbsolutePath('/skills/tdd/guide/README.md')}
          content={makeTextContent({ content: first, name: 'README.md' })}
        />
      </div>,
    )
    const stalePane = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    if (!stalePane)
      throw new Error('expected a markdown reading scroll container')
    // The path segment must remount at selection-commit time — without it the
    // pane below is the SAME node still showing the old document's scroll.
    expect(stalePane).not.toBe(initialPane)
    stalePane.scrollTop = 900
    expect(stalePane.scrollTop).toBeGreaterThan(0)

    // Act — the read resolves: same path, new document.
    await screen.rerender(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          filePath={toAbsolutePath('/skills/tdd/guide/README.md')}
          content={makeTextContent({ content: second, name: 'README.md' })}
        />
      </div>,
    )

    // Assert — the arriving document opens at top; scroll accrued on the stale
    // document must not carry over.
    await expect
      .element(screen.getByRole('heading', { name: 'Second' }))
      .toBeVisible()
    const freshPane = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    expect(freshPane?.scrollTop).toBe(0)
  })

  // Value: protects=Reading Mode reopens a reloaded file at top when its length changed; fails_when=the key loses the content.length segment — both docs share path, name AND lineCount, so content.length is the sole discriminator and stale scroll would survive; why_new=the stale-window test's fixtures differ in BOTH shape segments, so each segment alone is unpinned; seam=none
  test('resets Reading Mode scroll when a reloaded file keeps its line count but changes length', async () => {
    // Arrange — a same-path reload after an external edit: both documents have
    // 83 lines, but the bodies differ in length, so only the content.length
    // key segment can remount the pane. Long repeated units keep BOTH rendered
    // documents taller than the 220px pane — a non-overflowing second document
    // would satisfy scrollTop === 0 vacuously without a remount.
    const { FileContent } = await import('./FileContent')
    const pathA = toAbsolutePath('/skills/tdd/SKILL.md')
    const screen = await render(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          filePath={pathA}
          content={makeTextContent({
            content: `# Alpha\n\n${'aa bb cc dd\n'.repeat(80)}`,
            name: 'SKILL.md',
          })}
        />
      </div>,
    )
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()
    const firstPane = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    if (!firstPane)
      throw new Error('expected a markdown reading scroll container')
    firstPane.scrollTop = 1200
    expect(firstPane.scrollTop).toBeGreaterThan(0)

    // Act — the file reloads with an 83-line document of a different length.
    await screen.rerender(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          filePath={pathA}
          content={makeTextContent({
            content: `# Omega\n\n${'zz zz zz\n'.repeat(80)}`,
            name: 'SKILL.md',
          })}
        />
      </div>,
    )

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'Omega' }))
      .toBeVisible()
    const secondPane = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    expect(secondPane?.scrollTop).toBe(0)
  })

  // Value: protects=Reading Mode reopens a reloaded file at top when its line count changed; fails_when=the key loses the lineCount segment — both docs share path, name AND content.length, so lineCount is the sole discriminator and stale scroll would survive; why_new=the stale-window test's fixtures differ in BOTH shape segments, so each segment alone is unpinned; seam=none
  test('resets Reading Mode scroll when a reloaded file keeps its length but changes line count', async () => {
    // Arrange — both documents are 849 characters but split into a different
    // number of lines (283 vs 108), so only the lineCount key segment can
    // remount the pane. Long repeated units keep BOTH rendered documents
    // taller than the 220px pane — a non-overflowing second document would
    // satisfy scrollTop === 0 vacuously without a remount.
    const { FileContent } = await import('./FileContent')
    const pathA = toAbsolutePath('/skills/tdd/SKILL.md')
    const screen = await render(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          filePath={pathA}
          content={makeTextContent({
            content: `# Alpha\n\n${'xy\n'.repeat(280)}`,
            name: 'SKILL.md',
          })}
        />
      </div>,
    )
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()
    const firstPane = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    if (!firstPane)
      throw new Error('expected a markdown reading scroll container')
    firstPane.scrollTop = 1200
    expect(firstPane.scrollTop).toBeGreaterThan(0)

    // Act — the file reloads with a same-length document of 108 lines.
    await screen.rerender(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          filePath={pathA}
          content={makeTextContent({
            content: `# Omega\n\n${'yy zz ww\n'.repeat(105)}`,
            name: 'SKILL.md',
          })}
        />
      </div>,
    )

    // Assert
    await expect
      .element(screen.getByRole('heading', { name: 'Omega' }))
      .toBeVisible()
    const secondPane = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    expect(secondPane?.scrollTop).toBe(0)
  })

  // Value: protects=a new preview surface that forgets filePath gets a loud signal; fails_when=the per-mount warn is deleted or stops firing, letting the basename fallback silently regress same-basename scroll; why_new=the warn exists so the optional prop can't be dropped silently — without coverage the signal itself can rot; seam=none
  test('warns once per mount when a Markdown file renders without filePath', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const screen = await render(
        <FileContent content={makeTextContent({ content: '# Doc\n' })} />,
      )

      // Assert — one warning for this mount.
      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalledTimes(1)
      })
      expect(warnSpy).toHaveBeenCalledWith(
        '[FileContent] Markdown preview rendered without an absolute filePath; same-basename files share one scroll key',
      )

      // Act — flip the file to non-Markdown and back on the SAME mounted
      // surface: the effect deps ([isMarkdown, filePath]) change, forcing a
      // re-run that must find the latch already set and not warn again.
      await screen.rerender(
        <FileContent
          content={makeTextContent({
            content: 'const x = 1\n',
            name: 'snippet.ts',
            extension: '.ts',
          })}
        />,
      )
      await screen.rerender(
        <FileContent
          content={makeTextContent({ content: '# Doc\n\nmore\n' })}
        />,
      )

      // Assert — the per-mount latch held through the dep-change re-run.
      expect(warnSpy).toHaveBeenCalledTimes(1)

      // Act — a SECOND mounted surface warns independently; this is the
      // contract that pins per-mount granularity (a module-level once-flag
      // would stay silent here).
      await render(
        <div>
          <FileContent content={makeTextContent({ content: '# Other\n' })} />
        </div>,
      )

      // Assert
      await vi.waitFor(() => {
        expect(warnSpy).toHaveBeenCalledTimes(2)
      })
    } finally {
      warnSpy.mockRestore()
    }
  })

  // Value: protects=scroll position survives same-file rerenders so Reading Mode never jumps mid-read; fails_when=the key gains an unstable segment (fontSizePx, a counter, Math.random) that remounts on every prop change; why_new=the scroll-reset tests only pin the remount half of the key contract — an always-remounting key would pass them while making reading unusable; seam=none
  test('keeps Reading Mode scroll position when the same file re-renders with a new font size', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          filePath={toAbsolutePath('/skills/tdd/README.md')}
          content={makeTextContent({
            content: `# Doc\n\n${'line\n'.repeat(200)}`,
            name: 'README.md',
          })}
          markdownFontSizePx={13}
        />
      </div>,
    )
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()
    const pane = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    if (!pane) throw new Error('expected a markdown reading scroll container')
    pane.scrollTop = 800
    expect(pane.scrollTop).toBeGreaterThan(0)

    // Act — same file, only the reading font size changed (a prop change that
    // must re-render in place, not remount the scroll container).
    await screen.rerender(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          filePath={toAbsolutePath('/skills/tdd/README.md')}
          content={makeTextContent({
            content: `# Doc\n\n${'line\n'.repeat(200)}`,
            name: 'README.md',
          })}
          markdownFontSizePx={18}
        />
      </div>,
    )

    // Assert
    const samePane = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    expect(samePane?.scrollTop).toBeGreaterThan(0)
  })

  test('reopens Markdown in Reading Mode after an app restart when Reading was last selected', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const firstScreen = await render(
      <FileContent content={makeTextContent({ content: '# Restored\n' })} />,
    )
    await firstScreen
      .getByRole('radio', { name: /Show rendered Markdown/i })
      .click()
    await firstScreen.unmount()

    // Act
    const screen = await render(
      <FileContent content={makeTextContent({ content: '# Restored\n' })} />,
    )

    // Assert
    expect(window.localStorage.getItem(MARKDOWN_PREVIEW_MODE_KEY)).toBe(
      'reading',
    )
    await expect
      .element(screen.getByRole('heading', { name: 'Restored' }))
      .toBeVisible()
  })

  test('reopens Markdown in Code mode after an app restart when Code was re-selected after Reading', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const firstScreen = await render(
      <FileContent content={makeTextContent({ content: '# Install\n' })} />,
    )
    await firstScreen
      .getByRole('radio', { name: /Show rendered Markdown/i })
      .click()
    await firstScreen
      .getByRole('radio', { name: /Show Markdown source/i })
      .click()
    await firstScreen.unmount()

    // Act
    const screen = await render(
      <FileContent content={makeTextContent({ content: '# Install\n' })} />,
    )

    // Assert
    expect(window.localStorage.getItem(MARKDOWN_PREVIEW_MODE_KEY)).toBe('code')
    await expect
      .element(screen.getByRole('radio', { name: /Show Markdown source/i }))
      .toHaveAttribute('aria-checked', 'true')
  })

  test('falls back to Code mode when the stored preview mode is unrecognized', async () => {
    // Arrange
    window.localStorage.setItem(MARKDOWN_PREVIEW_MODE_KEY, 'garbage')
    const { FileContent } = await import('./FileContent')

    // Act
    const screen = await render(
      <FileContent content={makeTextContent({ content: '# Install\n' })} />,
    )

    // Assert
    await expect
      .element(screen.getByRole('radio', { name: /Show Markdown source/i }))
      .toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('heading', { name: 'Install' }).query()).toBeNull()
  })

  test('still opens Markdown in Code mode when localStorage reads throw', async () => {
    // Arrange
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    const { FileContent } = await import('./FileContent')

    // Act
    const screen = await render(
      <FileContent content={makeTextContent({ content: '# Install\n' })} />,
    )

    // Assert
    await expect
      .element(screen.getByRole('radio', { name: /Show Markdown source/i }))
      .toHaveAttribute('aria-checked', 'true')
  })

  test('still switches to Reading Mode when localStorage writes throw', async () => {
    // Arrange
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent content={makeTextContent({ content: '# Install\n' })} />,
    )

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[FileContent] persisting markdown preview mode failed',
      expect.any(Error),
    )
    await expect
      .element(screen.getByRole('heading', { name: 'Install' }))
      .toBeVisible()
  })

  test('keeps the new file preview when a previous file highlight rejects after switching files', async () => {
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

  test('keeps Markdown that starts with a horizontal rule in Reading Mode', async () => {
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

  test('renders language-less code fences as block code without AST attributes', async () => {
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

  test('renders language-tagged code fences as block code', async () => {
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

  test('locks Reading Mode to vertical scrolling when Markdown is wider than the pane', async () => {
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

  test('adds a bottom spacer after source code so the final line can breathe', async () => {
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

  test('keeps source code line numbers pinned while horizontally scrolling long Markdown source', async () => {
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
  test('prompts the user to pick a file when nothing is selected', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')

    // Act
    const screen = await render(<FileContent content={makeEmptyContent()} />)

    // Assert
    await expect
      .element(screen.getByText('Select a file to preview'))
      .toBeInTheDocument()
  })

  test('explains that a binary file cannot be previewed and shows its size', async () => {
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

  test('shows the image itself when previewing an image file', async () => {
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
  test('opens Markdown links in a new tab safely', async () => {
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

  test('renders Markdown blockquotes as quoted callouts', async () => {
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

  test('renders Markdown section and subsection headings as h2 and h3', async () => {
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

  test('renders ordered Markdown lists as numbered lists', async () => {
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

  test('renders GitHub Flavored Markdown tables with header and body cells', async () => {
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
  test('renders the Markdown reading view at the configured body font size', async () => {
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

  test('renders the code view at the configured code font size', async () => {
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
