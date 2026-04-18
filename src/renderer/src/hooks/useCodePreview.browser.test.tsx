import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

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
  it('loads files and auto-selects first file content', async () => {
    const file = makeFile()
    const body = makeTextContent()
    listMock.mockResolvedValue([file])
    readMock.mockResolvedValue(body)

    const { useCodePreview } = await import('./useCodePreview')
    const { result } = await renderHook(() => useCodePreview('/skills/tdd'))

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

  it('handles empty skill by leaving content empty', async () => {
    listMock.mockResolvedValue([])

    const { useCodePreview } = await import('./useCodePreview')
    const { result } = await renderHook(() => useCodePreview('/skills/empty'))

    // `content` is `{kind:'empty'}` before AND after the effect for this case,
    // so gate on the IPC call count instead to prove the effect actually ran.
    await expect.poll(() => listMock.mock.calls.length).toBe(1)
    await expect.poll(() => result.current.loading).toBe(false)
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
    const { result, act } = await renderHook(() =>
      useCodePreview('/skills/tdd'),
    )

    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'text', data: firstBody })

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
    const { result, act } = await renderHook(() =>
      useCodePreview('/skills/tdd'),
    )

    await expect.poll(() => result.current.activeFile).toBe(file.path)
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

    await act(async () => {
      await result.current.setActiveFile(second.path)
    })
    expect(result.current.activeFile).toBe(second.path)
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
    const { result, act } = await renderHook(() =>
      useCodePreview('/skills/tdd'),
    )

    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'text', data: firstBody })

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

    rerender({ path: '/skills/b' })

    // Synchronous reset branch: the render-phase `setUserSelectedFile(null)`
    // + `setContent({kind:'empty'})` in useCodePreview fire when
    // `prevSkillPathRef.current !== skillPath`. With the listMock for path B
    // hanging, the effect stalls at `await list()` so we observe the
    // post-reset, pre-IPC snapshot: loading=true (loadedPath still /skills/a)
    // and content={kind:'empty'}.
    await expect.poll(() => result.current.loading).toBe(true)
    expect(result.current.content).toEqual({ kind: 'empty' })

    // Unblock path B's IPC and verify the eventual happy path. Wrapping the
    // resolver call in `act()` keeps effect flushing under React's control
    // and sidesteps TS's closure-narrowing of `resolveListB` to `null`.
    await act(async () => {
      resolveListB?.([fileB])
      await Promise.resolve()
    })
    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'text', data: bodyB })
    expect(result.current.activeFile).toBe(fileB.path)
    expect(result.current.loading).toBe(false)
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
    const { result } = await renderHook(() => useCodePreview('/skills/tdd'))

    await expect
      .poll(() => result.current.content)
      .toEqual({ kind: 'image', data: binary })
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
    const { result } = await renderHook(() => useCodePreview('/skills/tdd'))

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
})
