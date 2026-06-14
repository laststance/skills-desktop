import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

import type {
  SkillBinaryContent,
  SkillFile,
  SkillFileContent,
} from '@/shared/types'

const listMock = vi.fn<(skillPath: string) => Promise<SkillFile[]>>()
const readMock = vi.fn<(filePath: string) => Promise<SkillFileContent | null>>()
const readBinaryMock =
  vi.fn<(filePath: string) => Promise<SkillBinaryContent | null>>()

/**
 * Build a SkillFile fixture with sane defaults.
 * @param overrides - Partial overrides
 * @returns Complete SkillFile
 * @example makeFile({ name: 'README.md' }) // => SkillFile with name README.md
 */
function makeFile(overrides: Partial<SkillFile> = {}): SkillFile {
  return {
    name: 'SKILL.md',
    path: '/skills/tdd/SKILL.md',
    relativePath: 'SKILL.md',
    extension: '.md',
    size: 100,
    previewable: 'text',
    ...overrides,
  }
}

/**
 * Build a SkillFileContent fixture with sane defaults.
 * @param overrides - Partial overrides
 * @returns Complete SkillFileContent
 */
function makeTextContent(
  overrides: Partial<SkillFileContent> = {},
): SkillFileContent {
  return {
    name: 'SKILL.md',
    content: 'hello',
    extension: '.md',
    lineCount: 1,
    ...overrides,
  }
}

beforeEach(() => {
  listMock.mockReset()
  readMock.mockReset()
  readBinaryMock.mockReset()
  // Stub only the `electron` global. In browser mode Vitest reuses the page
  // per file by default; `vi.stubGlobal` + `vi.unstubAllGlobals()` pairs up
  // to prevent one test's fake IPC from leaking into the next.
  vi.stubGlobal('electron', {
    files: {
      list: listMock,
      read: readMock,
      readBinary: readBinaryMock,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useCodePreview', () => {
  it('auto-selects and previews the first file when a skill is opened', async () => {
    // Arrange
    const file = makeFile()
    const body = makeTextContent()
    listMock.mockResolvedValue([file])
    readMock.mockResolvedValue(body)

    // Act
    const { useCodePreview } = await import('./useCodePreview')
    const { result } = await renderHook(() => useCodePreview('/skills/tdd'))

    // Assert
    // Poll the loaded content instead of `loading === false`. `loading` starts
    // false and transitions true→false, so a `loading === false` poll can race
    // past the effect and observe the pre-load snapshot.
    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'text', data: body })
    expect(result.current.files).toEqual([file])
    expect(result.current.activeFile).toBe(file.path)
    expect(result.current.loading).toBe(false)
  })

  it('shows an empty preview and reads no file content when the skill has no files', async () => {
    // Arrange
    listMock.mockResolvedValue([])

    // Act
    const { useCodePreview } = await import('./useCodePreview')
    const { result } = await renderHook(() => useCodePreview('/skills/empty'))

    // Assert
    // `content` is `{kind:'empty'}` before AND after the effect for this case,
    // so gate on the IPC call count instead to prove the effect actually ran.
    await expect.poll(() => listMock.mock.calls.length).toBe(1)
    await expect.poll(() => result.current.loading).toBe(false)
    expect(result.current.activeFile).toBeNull()
    expect(result.current.content).toEqual({ kind: 'empty' })
    expect(readMock).not.toHaveBeenCalled()
  })

  it('previews a different file when the user selects it', async () => {
    // Arrange
    const first = makeFile()
    const second = makeFile({
      name: 'notes.md',
      path: '/skills/tdd/notes.md',
      relativePath: 'notes.md',
    })
    const firstBody = makeTextContent()
    const secondBody = makeTextContent({ name: 'notes.md', content: 'notes' })
    listMock.mockResolvedValue([first, second])
    readMock.mockImplementation(async (p) =>
      p === first.path ? firstBody : secondBody,
    )

    const { useCodePreview } = await import('./useCodePreview')
    const { result, act } = await renderHook(() =>
      useCodePreview('/skills/tdd'),
    )

    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'text', data: firstBody })

    // Act
    await act(async () => {
      await result.current.setActiveFile(second.path)
    })

    // Assert
    expect(result.current.activeFile).toBe(second.path)
    expect(result.current.content).toEqual({ kind: 'text', data: secondBody })
  })

  it('does not re-fetch when the user re-selects the file already being previewed', async () => {
    // Arrange
    const file = makeFile()
    listMock.mockResolvedValue([file])
    readMock.mockResolvedValue(makeTextContent())

    const { useCodePreview } = await import('./useCodePreview')
    const { result, act } = await renderHook(() =>
      useCodePreview('/skills/tdd'),
    )

    await expect.poll(() => result.current.activeFile).toBe(file.path)
    expect(readMock).toHaveBeenCalledTimes(1)

    // Act
    await act(async () => {
      await result.current.setActiveFile(file.path)
    })

    // Assert
    // No extra read — the guard short-circuited before the IPC call
    expect(readMock).toHaveBeenCalledTimes(1)
  })

  it('clears the preview to empty when the active file is deselected', async () => {
    // Arrange
    const file = makeFile()
    const body = makeTextContent()
    listMock.mockResolvedValue([file])
    readMock.mockResolvedValue(body)

    const { useCodePreview } = await import('./useCodePreview')
    const { result, act } = await renderHook(() =>
      useCodePreview('/skills/tdd'),
    )

    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'text', data: body })

    // Act
    await act(async () => {
      await result.current.setActiveFile(null)
    })

    // Assert
    // Deselecting wipes the preview to the empty state without any IPC read.
    expect(result.current.content).toEqual({ kind: 'empty' })
    // Only the initial auto-select read ran — clearing skips loadContentForFile.
    expect(readMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the user-selected file showing when a slow initial-load read finally resolves', async () => {
    // Arrange
    const first = makeFile()
    const second = makeFile({
      name: 'notes.md',
      path: '/skills/tdd/notes.md',
      relativePath: 'notes.md',
    })
    const secondBody = makeTextContent({ name: 'notes.md', content: 'notes' })

    listMock.mockResolvedValue([first, second])

    // read(first) hangs forever — simulates slow IPC for initial load.
    // read(second) resolves immediately — the user click's fetch wins.
    let resolveFirst: ((v: SkillFileContent | null) => void) | null = null
    readMock.mockImplementation(async (p) => {
      if (p === first.path) {
        return new Promise<SkillFileContent | null>((res) => {
          resolveFirst = res
        })
      }
      return secondBody
    })

    const { useCodePreview } = await import('./useCodePreview')
    const { result, act } = await renderHook(() =>
      useCodePreview('/skills/tdd'),
    )

    await expect.poll(() => result.current.files.length).toBe(2)
    // Gate on the IPC call itself: `files.length === 2` only proves `list()`
    // resolved. The stale-response branch we're exercising is on the read
    // promise, so assert read(first) is actually pending before continuing —
    // otherwise `resolveFirst?.(…)` below could silently no-op and the test
    // would pass without ever covering the guard.
    await expect
      .poll(() => readMock.mock.calls.some((c) => c[0] === first.path))
      .toBe(true)

    // Act
    await act(async () => {
      await result.current.setActiveFile(second.path)
    })

    // Assert
    expect(result.current.activeFile).toBe(second.path)
    expect(result.current.content).toEqual({ kind: 'text', data: secondBody })

    // Act
    // Now the slow initial read resolves — it must NOT clobber user's selection.
    await act(async () => {
      resolveFirst?.(makeTextContent())
      await Promise.resolve()
    })

    // Assert
    expect(result.current.activeFile).toBe(second.path)
    expect(result.current.content).toEqual({ kind: 'text', data: secondBody })
  })

  it('keeps the latest selection showing when a slow earlier selection finally resolves', async () => {
    // Arrange
    const first = makeFile()
    const second = makeFile({
      name: 'notes.md',
      path: '/skills/tdd/notes.md',
      relativePath: 'notes.md',
    })
    const third = makeFile({
      name: 'other.md',
      path: '/skills/tdd/other.md',
      relativePath: 'other.md',
    })
    const firstBody = makeTextContent()
    const thirdBody = makeTextContent({ name: 'other.md', content: 'third' })
    listMock.mockResolvedValue([first, second, third])

    // read(first) resolves normally for the initial auto-select.
    // read(second) hangs — that's the "slow prior setActiveFile" we race against.
    // read(third) resolves with `thirdBody` — the user's final click.
    let resolveSecond: ((v: SkillFileContent | null) => void) | null = null
    readMock.mockImplementation(async (p) => {
      if (p === first.path) return firstBody
      if (p === second.path) {
        return new Promise<SkillFileContent | null>((res) => {
          resolveSecond = res
        })
      }
      return thirdBody
    })

    const { useCodePreview } = await import('./useCodePreview')
    const { result, act } = await renderHook(() =>
      useCodePreview('/skills/tdd'),
    )

    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'text', data: firstBody })

    // Act
    // Fire the slow click — don't await so the fetch stays pending.
    let slowPromise: Promise<void> | null = null
    await act(async () => {
      slowPromise = result.current.setActiveFile(second.path)
      // Yield once so setUserSelectedFile's state update flushes before
      // the next setActiveFile call reads `activeFile` via closure.
      await Promise.resolve()
    })

    // Assert
    expect(result.current.activeFile).toBe(second.path)

    // Act
    // Fire the winning click — this one resolves quickly.
    await act(async () => {
      await result.current.setActiveFile(third.path)
    })

    // Assert
    expect(result.current.activeFile).toBe(third.path)
    expect(result.current.content).toEqual({ kind: 'text', data: thirdBody })

    // Act
    // Now resolve the hanging read(second). Guard must drop its result.
    await act(async () => {
      resolveSecond?.(makeTextContent({ name: 'notes.md', content: 'stale' }))
      await slowPromise
    })

    // Assert
    expect(result.current.activeFile).toBe(third.path)
    expect(result.current.content).toEqual({ kind: 'text', data: thirdBody })
  })

  it('clears the previous file preview immediately when the user switches to another skill', async () => {
    // Arrange
    const fileA = makeFile({
      path: '/skills/a/SKILL.md',
      relativePath: 'SKILL.md',
    })
    const fileB = makeFile({
      name: 'b.md',
      path: '/skills/b/SKILL.md',
      relativePath: 'SKILL.md',
    })
    const bodyA = makeTextContent({ content: 'A' })
    const bodyB = makeTextContent({ content: 'B' })

    // Path A resolves immediately. Path B's list hangs on an external promise
    // so the assertion can observe the synchronous reset *between* rerender
    // and the new skill's IPC completion — otherwise the eventual state would
    // mask whether the render-phase reset branch actually fired.
    let resolveListB: ((v: SkillFile[]) => void) | null = null
    listMock.mockImplementation(async (p) => {
      if (p === '/skills/a') return [fileA]
      return new Promise<SkillFile[]>((res) => {
        resolveListB = res
      })
    })
    readMock.mockImplementation(async (p) => (p === fileA.path ? bodyA : bodyB))

    const { useCodePreview } = await import('./useCodePreview')
    const { result, rerender, act } = await renderHook(
      (props?: { path: string }) => useCodePreview(props?.path ?? '/skills/a'),
      { initialProps: { path: '/skills/a' } },
    )

    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'text', data: bodyA })

    // Act
    rerender({ path: '/skills/b' })

    // Assert
    // Synchronous reset branch: the render-phase `setUserSelectedFile(null)`
    // + `setContent({kind:'empty'})` in useCodePreview fire when
    // `prevSkillPathRef.current !== skillPath`. With the listMock for path B
    // hanging, the effect stalls at `await list()` so we observe the
    // post-reset, pre-IPC snapshot: loading=true (loadedPath still /skills/a)
    // and content={kind:'empty'}.
    await expect.poll(() => result.current.loading).toBe(true)
    expect(result.current.content).toEqual({ kind: 'empty' })

    // Act
    // Unblock path B's IPC and verify the eventual happy path. Wrapping the
    // resolver call in `act()` keeps effect flushing under React's control
    // and sidesteps TS's closure-narrowing of `resolveListB` to `null`.
    await act(async () => {
      resolveListB?.([fileB])
      await Promise.resolve()
    })

    // Assert
    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'text', data: bodyB })
    expect(result.current.activeFile).toBe(fileB.path)
    expect(result.current.loading).toBe(false)
  })

  it('previews an image file through the binary reader without calling the text reader', async () => {
    // Arrange
    const image = makeFile({
      name: 'logo.png',
      path: '/skills/tdd/logo.png',
      relativePath: 'logo.png',
      extension: '.png',
      previewable: 'image',
    })
    const binary: SkillBinaryContent = {
      name: 'logo.png',
      dataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      size: 10,
    }
    listMock.mockResolvedValue([image])
    readBinaryMock.mockResolvedValue(binary)

    // Act
    const { useCodePreview } = await import('./useCodePreview')
    const { result } = await renderHook(() => useCodePreview('/skills/tdd'))

    // Assert
    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'image', data: binary })
    expect(readMock).not.toHaveBeenCalled()
  })

  it('shows a placeholder instead of reading content for an oversized file', async () => {
    // Arrange
    const big = makeFile({
      name: 'dump.bin',
      path: '/skills/tdd/dump.bin',
      relativePath: 'dump.bin',
      extension: '.bin',
      size: 999_999,
      previewable: 'binary',
    })
    listMock.mockResolvedValue([big])

    // Act
    const { useCodePreview } = await import('./useCodePreview')
    const { result } = await renderHook(() => useCodePreview('/skills/tdd'))

    // Assert
    await expect
      .poll(() => result.current.content)
      .toEqual({
        kind: 'binary',
        fileName: 'dump.bin',
        size: 999_999,
      })
    expect(readMock).not.toHaveBeenCalled()
    expect(readBinaryMock).not.toHaveBeenCalled()
  })

  it('drops the abandoned skill files when the user switches skills before the first list resolves', async () => {
    // Arrange
    const fileA = makeFile({
      name: 'a.md',
      path: '/skills/a/a.md',
      relativePath: 'a.md',
    })
    const fileB = makeFile({
      name: 'b.md',
      path: '/skills/b/b.md',
      relativePath: 'b.md',
    })
    const bodyB = makeTextContent({ name: 'b.md', content: 'B' })

    // Skill A's list() hangs on an external promise so its effect is still
    // mid-`await` when the user switches to skill B. Skill B resolves normally.
    let resolveListA: ((v: SkillFile[]) => void) | null = null
    listMock.mockImplementation(async (p) => {
      if (p === '/skills/a') {
        return new Promise<SkillFile[]>((res) => {
          resolveListA = res
        })
      }
      return [fileB]
    })
    readMock.mockResolvedValue(bodyB)

    const { useCodePreview } = await import('./useCodePreview')
    const { result, rerender, act } = await renderHook(
      (props?: { path: string }) => useCodePreview(props?.path ?? '/skills/a'),
      { initialProps: { path: '/skills/a' } },
    )

    // Gate on skill A's list() actually being in flight before switching, so
    // the cleanup that flips its `cancelled` flag has something to cancel.
    await expect
      .poll(() => listMock.mock.calls.some((c) => c[0] === '/skills/a'))
      .toBe(true)

    // Act
    // Switch to skill B — this tears down A's effect (cancelled = true).
    rerender({ path: '/skills/b' })
    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'text', data: bodyB })

    // Act
    // Now the abandoned skill A list finally resolves. The cancelled guard must
    // drop it so skill B's files are never clobbered.
    await act(async () => {
      resolveListA?.([fileA])
      await Promise.resolve()
    })

    // Assert
    // Skill B's files and content survive; the stale A list was discarded.
    expect(result.current.files).toEqual([fileB])
    expect(result.current.activeFile).toBe(fileB.path)
    expect(result.current.content).toEqual({ kind: 'text', data: bodyB })
  })

  it('ignores a request to preview a path that is not in the file list and reads nothing extra', async () => {
    // Arrange
    const file = makeFile()
    const body = makeTextContent()
    listMock.mockResolvedValue([file])
    readMock.mockResolvedValue(body)

    const { useCodePreview } = await import('./useCodePreview')
    const { result, act } = await renderHook(() =>
      useCodePreview('/skills/tdd'),
    )

    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'text', data: body })
    expect(readMock).toHaveBeenCalledTimes(1)

    // Act
    // Ask for a path that never appeared in `files` (e.g. a ghost file removed
    // from disk between list and click). It differs from activeFile so the
    // early `path === activeFile` guard does not short-circuit first.
    await act(async () => {
      await result.current.setActiveFile('/skills/tdd/ghost.md')
    })

    // Assert
    // The unknown path is ignored: no extra read fires and the preview is
    // unchanged from the original auto-selected file.
    expect(readMock).toHaveBeenCalledTimes(1)
    expect(result.current.content).toEqual({ kind: 'text', data: body })
  })

  it('shows an empty preview when a text file read returns null because the file vanished mid-load', async () => {
    // Arrange
    const file = makeFile()
    listMock.mockResolvedValue([file])
    // read() resolves null — the file was deleted or became unreadable between
    // listing and reading.
    readMock.mockResolvedValue(null)

    // Act
    const { useCodePreview } = await import('./useCodePreview')
    const { result } = await renderHook(() => useCodePreview('/skills/tdd'))

    // Assert
    await expect.poll(() => result.current.content).toEqual({ kind: 'empty' })
    expect(readMock).toHaveBeenCalledTimes(1)
  })

  it('shows an empty preview when an image file read returns null because the image vanished mid-load', async () => {
    // Arrange
    const image = makeFile({
      name: 'logo.png',
      path: '/skills/tdd/logo.png',
      relativePath: 'logo.png',
      extension: '.png',
      previewable: 'image',
    })
    listMock.mockResolvedValue([image])
    // readBinary() resolves null — the image was deleted or became unreadable
    // between listing and reading.
    readBinaryMock.mockResolvedValue(null)

    // Act
    const { useCodePreview } = await import('./useCodePreview')
    const { result } = await renderHook(() => useCodePreview('/skills/tdd'))

    // Assert
    await expect.poll(() => result.current.content).toEqual({ kind: 'empty' })
    expect(readBinaryMock).toHaveBeenCalledTimes(1)
  })
})
