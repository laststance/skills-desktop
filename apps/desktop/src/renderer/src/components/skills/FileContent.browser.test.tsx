import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import '@/renderer/src/styles/globals.css'
import { MARKDOWN_PREVIEW_MODE_KEY } from '@/shared/constants'
import {
  toDataUrl,
  toFileExtension,
  toFileName,
  toFileSizeBytes,
  toLineCount,
  toMimeType,
} from '@/shared/types'

import { resetMarkdownPreviewModeForTests } from './FileContent'
import * as shikiPreview from './shikiPreview'

// The Markdown preview mode toggle persists to real localStorage AND a
// module-level session cache; reset both so one test's selection can't leak
// into the next test's default-mode assertions.
beforeEach(() => {
  window.localStorage.removeItem(MARKDOWN_PREVIEW_MODE_KEY)
  resetMarkdownPreviewModeForTests()
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
  resetMarkdownPreviewModeForTests()
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

  // Value: protects=switching to a differently-named Markdown file in Reading Mode starts at the top; fails_when=the content-identity key is removed or the scroll container stops remounting on file change; why_new=mode persistence removed the mode-reset remount that used to mask this; seam=none
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

  // Value: protects=Reading Mode starts every switched-to Markdown file scrolled to top; fails_when=the reading pane stops remounting on content change — same-basename nested files would keep stale scroll; why_new=the Alpha/Omega fixtures share lineCount AND content.length, so only the document's actual bytes discriminate them — the identical-shape corner a path+shape key could not close; seam=none
  test('resets Reading Mode scroll position when switching between Markdown files that share a name', async () => {
    // Arrange — a skill's nested directories can hold different Markdown files
    // with the same basename; both load with file.name === 'README.md'. The
    // Alpha/Omega headings are the SAME length, so the two documents also
    // share lineCount and content.length: identical under any shape-derived
    // identity, different only in their bytes — which is what the
    // content-identity key remounts on. The fixed-height flex wrapper bounds
    // the preview pane so the scroll container actually overflows, and the
    // second file stays long so a stale offset remains clamped-valid — only
    // a real remount satisfies the assert.
    const { FileContent } = await import('./FileContent')
    const longContent = (heading: string): string =>
      `# ${heading}\n\n${'line\n'.repeat(200)}`
    const screen = await render(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
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

  // Value: protects=a file switch during a slow content read still opens the new file at top; fails_when=the reading pane remounts at selection-commit (old doc scroll-jumps + re-parses for nothing) OR stops remounting at content arrival (scroll accrued on the stale doc leaks in); why_new=useCodePreview commits the new path one IPC read before content lands — only a content-identity key stays stable through the window AND resets at arrival; seam=none
  test('keeps the stale document painted during the content read, then opens the new file at top', async () => {
    // Arrange — mimic useCodePreview's two-step commit: selection flips first,
    // then the IPC read resolves the new content. Between them the pane still
    // shows the PREVIOUS document.
    const { FileContent } = await import('./FileContent')
    const first = `# First\n\n${'line\n'.repeat(200)}`
    const second = `# Second\n\n${'row\n'.repeat(300)}`
    const screen = await render(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
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
    initialPane.scrollTop = 900
    expect(initialPane.scrollTop).toBeGreaterThan(0)

    // Act — selection committed: the rendered document is still the old one
    // (same content arriving through the rerender, as during the IPC window).
    // The content-identity key must NOT remount here — the old document keeps
    // its scroll instead of visibly jumping to top mid-read.
    await screen.rerender(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          content={makeTextContent({ content: first, name: 'README.md' })}
        />
      </div>,
    )
    const stalePane = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    expect(stalePane).toBe(initialPane)
    expect(stalePane?.scrollTop).toBeGreaterThan(0)

    // Act — the read resolves: new document bytes arrive.
    await screen.rerender(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
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

  // Value: protects=a reloaded file that keeps line count AND length still reopens at top; fails_when=scroll identity ever keys on shape metrics again — identically-shaped different content would skip the remount and leak scroll; why_new=the identical-shape corner: shape keys alone can never tell these documents apart, only their bytes can; seam=none
  test('resets Reading Mode scroll when a same-shape reload lands different content', async () => {
    // Arrange — both documents are 83 lines AND the same byte length, so only
    // content itself discriminates them. Long repeated units keep BOTH
    // rendered documents taller than the 220px pane — a non-overflowing
    // second document would satisfy scrollTop === 0 vacuously.
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          content={makeTextContent({
            content: `# Alpha\n\n${'aa bb cc\n'.repeat(80)}`,
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

    // Act — the file reloads: still 83 lines, still the same length, but the
    // body differs ('aa bb cc' -> 'zz yy xx' per line, both 8 chars).
    await screen.rerender(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          content={makeTextContent({
            content: `# Alpha\n\n${'zz yy xx\n'.repeat(80)}`,
            name: 'SKILL.md',
          })}
        />
      </div>,
    )

    // Assert
    const secondPane = screen.container.querySelector<HTMLElement>(
      '[data-markdown-reading-scroll]',
    )
    expect(secondPane).not.toBe(firstPane)
    expect(secondPane?.scrollTop).toBe(0)
  })

  // Value: protects=scroll position survives same-file rerenders so Reading Mode never jumps mid-read; fails_when=the key gains an unstable segment (fontSizePx, a counter, Math.random) that remounts on every prop change; why_new=the scroll-reset tests only pin the remount half of the key contract — an always-remounting key would pass them while making reading unusable; seam=none
  test('keeps Reading Mode scroll position when the same file re-renders with a new font size', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
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

  // Value: protects=Code Mode keeps scroll on same-file prop changes (e.g. font-size slider ticks) — an unstable key segment would wipe scroll AND force a full Shiki re-highlight flash on every change; fails_when=the code key gains an unstable segment; why_new=the reading pane has this guard; the code pane's remount half is pinned but its stability half is not; seam=none
  test('keeps Code Mode scroll position when the same file re-renders with a new font size', async () => {
    // Arrange — non-Markdown so the code pane shows without a mode toggle.
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          content={makeTextContent({
            content: `// doc\n${'code line\n'.repeat(200)}`,
            name: 'doc.ts',
            extension: '.ts',
          })}
          codeFontSizePx={13}
        />
      </div>,
    )
    const pane = screen.container.querySelector<HTMLElement>(
      '[data-file-preview-scroll]',
    )
    if (!pane) throw new Error('expected a code preview scroll container')
    pane.scrollTop = 800
    expect(pane.scrollTop).toBeGreaterThan(0)

    // Act — same file, only the code font size changed.
    await screen.rerender(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          content={makeTextContent({
            content: `// doc\n${'code line\n'.repeat(200)}`,
            name: 'doc.ts',
            extension: '.ts',
          })}
          codeFontSizePx={18}
        />
      </div>,
    )

    // Assert — same node, scroll preserved.
    const samePane = screen.container.querySelector<HTMLElement>(
      '[data-file-preview-scroll]',
    )
    expect(samePane).toBe(pane)
    expect(samePane?.scrollTop).toBeGreaterThan(0)
  })

  // Value: protects=Code Mode starts every switched-to file at top instead of clamping the previous file's offset into a shorter document; fails_when=the code pane loses its content-identity remount; why_new=code scroll kept the old file's position across switches — the worst of the two consistent choices; seam=none
  test('resets Code Mode scroll position when switching to another file', async () => {
    // Arrange — both sources stay longer than the 220px pane on the x-free
    // code view so a stale scrollTop would remain clamped-valid and only a
    // remount satisfies the assert.
    const { FileContent } = await import('./FileContent')
    const longContent = (marker: string): string =>
      `// ${marker}\n${'code line\n'.repeat(200)}`
    const screen = await render(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          content={makeTextContent({
            content: longContent('first'),
            name: 'alpha.ts',
            extension: '.ts',
          })}
        />
      </div>,
    )
    const firstPane = screen.container.querySelector<HTMLElement>(
      '[data-file-preview-scroll]',
    )
    if (!firstPane) throw new Error('expected a code preview scroll container')
    firstPane.scrollTop = 1200
    expect(firstPane.scrollTop).toBeGreaterThan(0)

    // Act — switch to a different file while staying in Code Mode.
    await screen.rerender(
      <div style={{ display: 'flex', height: 220 }}>
        <FileContent
          content={makeTextContent({
            content: longContent('second'),
            name: 'omega.ts',
            extension: '.ts',
          })}
        />
      </div>,
    )

    // Assert
    const secondPane = screen.container.querySelector<HTMLElement>(
      '[data-file-preview-scroll]',
    )
    expect(secondPane).not.toBe(firstPane)
    expect(secondPane?.scrollTop).toBe(0)
  })

  // Value: protects=a failed storage write cannot silently revert the user's mode mid-session when a non-text detour remounts the preview; fails_when=the session-level cache is dropped, or the read order stops preferring it (including inside the getItem-throws catch branch); why_new=the read order used to be storage-only, so an unmount + remount under a broken write resurrected the stale value; seam=none
  test('keeps the selected mode across a non-Markdown detour even when storage writes fail', async () => {
    // Arrange — storage accepts the initial read but rejects every write.
    const { FileContent } = await import('./FileContent')
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('denied', 'QuotaExceededError')
      })
    try {
      const screen = await render(
        <FileContent content={makeTextContent({ content: '# Choice\n' })} />,
      )
      await screen
        .getByRole('radio', { name: /Show rendered Markdown/i })
        .click()
      await expect
        .element(screen.getByRole('heading', { name: 'Choice' }))
        .toBeVisible()

      // Break reads too: the remount must land in the catch branch, where the
      // session cache is the ONLY surviving record of the choice.
      const getItemSpy = vi
        .spyOn(Storage.prototype, 'getItem')
        .mockImplementation(() => {
          throw new DOMException('denied', 'SecurityError')
        })
      try {
        // Act — detour through an image preview: TextPreview unmounts, so the
        // remount re-reads the mode — with storage fully broken, only the
        // session cache can preserve the choice.
        await screen.rerender(
          <FileContent
            content={makeImageContent('detour.png', TRANSPARENT_PNG_DATA_URL)}
          />,
        )
        await screen.rerender(
          <FileContent content={makeTextContent({ content: '# Choice\n' })} />,
        )

        // Assert — Reading Mode survived the remount despite the failed write
        // AND the read-time exception.
        await expect
          .element(
            screen.getByRole('radio', { name: /Show rendered Markdown/i }),
          )
          .toHaveAttribute('aria-checked', 'true')
      } finally {
        getItemSpy.mockRestore()
      }
    } finally {
      setItemSpy.mockRestore()
    }
  })

  // Value: protects=a second window's mode change reaching this surface via the shared origin is honored instead of diverging silently, while unrelated cross-window writes are ignored and removals reset to default; fails_when=the storage listener is removed, stops validating newValue, or drops its event.key filter (redux persists other slices to this origin, so an unfiltered listener would revert the mode on every unrelated write); why_new=storage events are the only channel that reaches THIS document for writes it did not make; seam=none
  test('adopts a preview mode written by another window through the storage event', async () => {
    // Arrange
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent content={makeTextContent({ content: '# Synced\n' })} />,
    )
    await expect
      .element(screen.getByRole('radio', { name: /Show Markdown source/i }))
      .toHaveAttribute('aria-checked', 'true')

    // Act — an UNRELATED cross-window write must be ignored: other features
    // persist to this origin too, and an unfiltered listener would treat
    // every one of them as a mode reset.
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'skills-desktop:unrelated-key',
        newValue: 'reading',
      }),
    )
    await expect
      .element(screen.getByRole('radio', { name: /Show Markdown source/i }))
      .toHaveAttribute('aria-checked', 'true')

    // Act — simulate the cross-window write the `storage` event carries.
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: MARKDOWN_PREVIEW_MODE_KEY,
        newValue: 'reading',
      }),
    )

    // Assert — this surface adopts the new mode (and the session cache is
    // updated, so a remount can't revert to a stale session value).
    await expect
      .element(screen.getByRole('radio', { name: /Show rendered Markdown/i }))
      .toHaveAttribute('aria-checked', 'true')
    await expect
      .element(screen.getByRole('heading', { name: 'Synced' }))
      .toBeVisible()

    // Act — a non-Markdown detour remounts the preview WITHOUT any storage
    // write having occurred: only the session cache could carry the adopted
    // 'reading' value, so this pins adoptMode's session write.
    await screen.rerender(
      <FileContent
        content={makeImageContent('detour.png', TRANSPARENT_PNG_DATA_URL)}
      />,
    )
    await screen.rerender(
      <FileContent content={makeTextContent({ content: '# Synced\n' })} />,
    )
    await expect
      .element(screen.getByRole('radio', { name: /Show rendered Markdown/i }))
      .toHaveAttribute('aria-checked', 'true')

    // Act — the key is REMOVED in the other window (newValue === null).
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: MARKDOWN_PREVIEW_MODE_KEY,
        newValue: null,
      }),
    )

    // Assert — the surface resets to the default mode.
    await expect
      .element(screen.getByRole('radio', { name: /Show Markdown source/i }))
      .toHaveAttribute('aria-checked', 'true')

    // Act — detour once more: a stale session entry would resurrect
    // 'reading' on remount, so this pins adoptMode(null)'s session clear.
    await screen.rerender(
      <FileContent
        content={makeImageContent('detour.png', TRANSPARENT_PNG_DATA_URL)}
      />,
    )
    await screen.rerender(
      <FileContent content={makeTextContent({ content: '# Synced\n' })} />,
    )
    await expect
      .element(screen.getByRole('radio', { name: /Show Markdown source/i }))
      .toHaveAttribute('aria-checked', 'true')
  })

  // Value: protects=two FileContent surfaces mounted in the same window agree on the mode instead of diverging after a toggle; fails_when=the same-window listener set is removed — storage events never reach the document that wrote, so this is the only channel for same-window surfaces; why_new=a future second preview surface would diverge silently without it; seam=none
  test('keeps a second mounted Markdown preview surface in sync when one toggles', async () => {
    // Arrange — two surfaces side by side, as a future marketplace preview
    // could mount alongside the detail pane.
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <div style={{ display: 'flex', gap: 8 }}>
        <FileContent content={makeTextContent({ content: '# Left\n' })} />
        <FileContent content={makeTextContent({ content: '# Right\n' })} />
      </div>,
    )
    const radios = screen.getByRole('radio', {
      name: /Show rendered Markdown/i,
    })
    // Both surfaces default to Code.
    await expect.element(radios.nth(0)).toHaveAttribute('aria-checked', 'false')
    await expect.element(radios.nth(1)).toHaveAttribute('aria-checked', 'false')

    // Act — toggle Reading on the first surface only.
    await radios.nth(0).click()

    // Assert — the sibling surface adopted the same mode (same-window
    // listener), and both render their documents.
    await expect.element(radios.nth(1)).toHaveAttribute('aria-checked', 'true')
    await expect
      .element(screen.getByRole('heading', { name: 'Left' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('heading', { name: 'Right' }))
      .toBeVisible()
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
    // Simulate a REAL restart: module state dies with the process while
    // localStorage persists. Without this reset the session cache would
    // carry 'reading' into the next mount and the storage hydration arm
    // under test would never run.
    resetMarkdownPreviewModeForTests()

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
    // Simulate a REAL restart: module state dies, localStorage persists.
    resetMarkdownPreviewModeForTests()

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
    const { toast } = await import('sonner')
    const toastErrorSpy = vi.spyOn(toast, 'error')
    const { FileContent } = await import('./FileContent')
    const screen = await render(
      <FileContent content={makeTextContent({ content: '# Install\n' })} />,
    )

    // Act
    await screen.getByRole('radio', { name: /Show rendered Markdown/i }).click()

    // Assert — the toggle still applies immediately, the failure is logged,
    // and the user gets a deduplicated toast explaining the real consequence
    // (choice applies now but resets on app close).
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[FileContent] persisting markdown preview mode failed',
      expect.any(Error),
    )
    expect(toastErrorSpy).toHaveBeenCalledWith(
      'Preview mode could not be saved',
      expect.objectContaining({
        id: 'markdown-preview-mode-save-error',
        description:
          'Your choice still applies now but resets when the app closes.',
      }),
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
