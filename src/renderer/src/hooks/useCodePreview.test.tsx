// @vitest-environment happy-dom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  SkillBinaryContent,
  SkillFile,
  SkillFileContent,
} from '../../../shared/types'

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
  // Stub only the `electron` key on the global object. Avoid stubbing `window`
  // itself — that would strip document/HTMLElement, which testing-library
  // needs. `vi.stubGlobal` is auto-reset between tests (unlike the previous
  // module-level `Object.assign(window, ...)`, which leaked across files).
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
  it('loads files and auto-selects first file content', async () => {
    const file = makeFile()
    const body = makeTextContent()
    listMock.mockResolvedValue([file])
    readMock.mockResolvedValue(body)

    const { useCodePreview } = await import('./useCodePreview')
    const { result } = renderHook(() => useCodePreview('/skills/tdd'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.files).toEqual([file])
    expect(result.current.activeFile).toBe(file.path)
    expect(result.current.content).toEqual({ kind: 'text', data: body })
  })

  it('handles empty skill by leaving content empty', async () => {
    listMock.mockResolvedValue([])

    const { useCodePreview } = await import('./useCodePreview')
    const { result } = renderHook(() => useCodePreview('/skills/empty'))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.activeFile).toBeNull()
    expect(result.current.content).toEqual({ kind: 'empty' })
    expect(readMock).not.toHaveBeenCalled()
  })

  it('setActiveFile fetches selected file content', async () => {
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
    const { result } = renderHook(() => useCodePreview('/skills/tdd'))

    await waitFor(() =>
      expect(result.current.content).toEqual({ kind: 'text', data: firstBody }),
    )

    await act(async () => {
      await result.current.setActiveFile(second.path)
    })

    expect(result.current.activeFile).toBe(second.path)
    expect(result.current.content).toEqual({ kind: 'text', data: secondBody })
  })

  it('setActiveFile is a no-op when clicking the already-active file', async () => {
    const file = makeFile()
    listMock.mockResolvedValue([file])
    readMock.mockResolvedValue(makeTextContent())

    const { useCodePreview } = await import('./useCodePreview')
    const { result } = renderHook(() => useCodePreview('/skills/tdd'))

    await waitFor(() => expect(result.current.activeFile).toBe(file.path))
    expect(readMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await result.current.setActiveFile(file.path)
    })

    // No extra read — the guard short-circuited before the IPC call
    expect(readMock).toHaveBeenCalledTimes(1)
  })

  it('race guard: user selection wins over slow initial-load setContent', async () => {
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
    const { result } = renderHook(() => useCodePreview('/skills/tdd'))

    await waitFor(() => expect(result.current.files.length).toBe(2))
    // At this point files are set but initial read(first) is still pending.

    await act(async () => {
      await result.current.setActiveFile(second.path)
    })
    expect(result.current.content).toEqual({ kind: 'text', data: secondBody })

    // Now the slow initial read resolves — it must NOT clobber user's selection.
    await act(async () => {
      resolveFirst?.(makeTextContent())
      await Promise.resolve()
    })
    expect(result.current.activeFile).toBe(second.path)
    expect(result.current.content).toEqual({ kind: 'text', data: secondBody })
  })

  it('race guard: subsequent user selection wins over slow prior setActiveFile', async () => {
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
    const { result } = renderHook(() => useCodePreview('/skills/tdd'))

    await waitFor(() =>
      expect(result.current.content).toEqual({ kind: 'text', data: firstBody }),
    )

    // Fire the slow click — don't await so the fetch stays pending.
    let slowPromise: Promise<void> | null = null
    await act(async () => {
      slowPromise = result.current.setActiveFile(second.path)
      // Yield once so setUserSelectedFile's state update flushes before
      // the next setActiveFile call reads `activeFile` via closure.
      await Promise.resolve()
    })
    expect(result.current.activeFile).toBe(second.path)

    // Fire the winning click — this one resolves quickly.
    await act(async () => {
      await result.current.setActiveFile(third.path)
    })
    expect(result.current.activeFile).toBe(third.path)
    expect(result.current.content).toEqual({ kind: 'text', data: thirdBody })

    // Now resolve the hanging read(second). Guard must drop its result.
    await act(async () => {
      resolveSecond?.(makeTextContent({ name: 'notes.md', content: 'stale' }))
      await slowPromise
    })
    expect(result.current.activeFile).toBe(third.path)
    expect(result.current.content).toEqual({ kind: 'text', data: thirdBody })
  })

  it('skillPath change resets state synchronously', async () => {
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
    listMock.mockImplementation(async (p) =>
      p === '/skills/a' ? [fileA] : [fileB],
    )
    readMock.mockImplementation(async (p) => (p === fileA.path ? bodyA : bodyB))

    const { useCodePreview } = await import('./useCodePreview')
    const { result, rerender } = renderHook(
      ({ path }: { path: string }) => useCodePreview(path),
      { initialProps: { path: '/skills/a' } },
    )

    await waitFor(() =>
      expect(result.current.content).toEqual({ kind: 'text', data: bodyA }),
    )

    rerender({ path: '/skills/b' })
    // Synchronous branch: loading flips true and content resets before any IPC resolves.
    expect(result.current.loading).toBe(true)
    expect(result.current.content).toEqual({ kind: 'empty' })

    await waitFor(() =>
      expect(result.current.content).toEqual({ kind: 'text', data: bodyB }),
    )
    expect(result.current.activeFile).toBe(fileB.path)
  })

  it('routes image files through readBinary', async () => {
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

    const { useCodePreview } = await import('./useCodePreview')
    const { result } = renderHook(() => useCodePreview('/skills/tdd'))

    await waitFor(() =>
      expect(result.current.content).toEqual({ kind: 'image', data: binary }),
    )
    expect(readMock).not.toHaveBeenCalled()
  })

  it('falls back to binary placeholder for oversized files', async () => {
    const big = makeFile({
      name: 'dump.bin',
      path: '/skills/tdd/dump.bin',
      relativePath: 'dump.bin',
      extension: '.bin',
      size: 999_999,
      previewable: 'binary',
    })
    listMock.mockResolvedValue([big])

    const { useCodePreview } = await import('./useCodePreview')
    const { result } = renderHook(() => useCodePreview('/skills/tdd'))

    await waitFor(() =>
      expect(result.current.content).toEqual({
        kind: 'binary',
        fileName: 'dump.bin',
        size: 999_999,
      }),
    )
    expect(readMock).not.toHaveBeenCalled()
    expect(readBinaryMock).not.toHaveBeenCalled()
  })
})
