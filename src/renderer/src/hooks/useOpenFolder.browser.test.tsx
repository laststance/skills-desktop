import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

import type { FolderActionResult } from '../../../shared/types'

const revealMock = vi.fn<(folderPath: string) => Promise<FolderActionResult>>()
const openTerminalMock =
  vi.fn<(folderPath: string) => Promise<FolderActionResult>>()

const toastErrorMock = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

beforeEach(() => {
  revealMock.mockReset()
  openTerminalMock.mockReset()
  toastErrorMock.mockReset()
  vi.stubGlobal('electron', {
    folder: {
      revealInFinder: revealMock,
      openInTerminal: openTerminalMock,
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useOpenFolder', () => {
  it('does not toast on successful revealInFinder', async () => {
    revealMock.mockResolvedValue({ ok: true })
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result } = await renderHook(() => useOpenFolder())

    await result.current.revealInFinder('/x' as never)

    expect(revealMock).toHaveBeenCalledWith('/x')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('toasts the error message on failed revealInFinder', async () => {
    revealMock.mockResolvedValue({
      ok: false,
      reason: 'launch-failed',
      message: 'boom',
    })
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result } = await renderHook(() => useOpenFolder())

    await result.current.revealInFinder('/x' as never)

    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith('boom')
  })

  it('does not toast on successful openInTerminal', async () => {
    openTerminalMock.mockResolvedValue({ ok: true })
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result } = await renderHook(() => useOpenFolder())

    await result.current.openInTerminal('/x' as never)

    expect(openTerminalMock).toHaveBeenCalledWith('/x')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('toasts the error message on failed openInTerminal', async () => {
    openTerminalMock.mockResolvedValue({
      ok: false,
      reason: 'not-found',
      message: 'Folder not found: /missing',
    })
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result } = await renderHook(() => useOpenFolder())

    await result.current.openInTerminal('/missing' as never)

    expect(toastErrorMock).toHaveBeenCalledWith('Folder not found: /missing')
  })

  it('toasts a fallback message when revealInFinder rejects (e.g. main rethrows EPERM)', async () => {
    // The main process rethrows unexpected errors (EPERM, etc.) past the
    // structured `{ok:false}` boundary — see folder.ts. Without try/catch
    // here the user would get no feedback at all on those paths.
    revealMock.mockRejectedValue(new Error('EPERM'))
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result } = await renderHook(() => useOpenFolder())

    await result.current.revealInFinder('/locked' as never)

    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Failed to reveal folder in Finder',
    )
  })

  it('toasts a fallback message when openInTerminal rejects', async () => {
    openTerminalMock.mockRejectedValue(new Error('EPERM'))
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result } = await renderHook(() => useOpenFolder())

    await result.current.openInTerminal('/locked' as never)

    expect(toastErrorMock).toHaveBeenCalledWith(
      'Failed to open folder in terminal',
    )
  })

  it('returns referentially-stable callbacks across re-renders', async () => {
    revealMock.mockResolvedValue({ ok: true })
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result, rerender } = await renderHook(() => useOpenFolder())

    const firstReveal = result.current.revealInFinder
    const firstOpen = result.current.openInTerminal

    await rerender()

    expect(result.current.revealInFinder).toBe(firstReveal)
    expect(result.current.openInTerminal).toBe(firstOpen)
  })
})
