import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

import type { FolderActionResult } from '@/shared/types'

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
  it('does not show an error toast when revealInFinder succeeds', async () => {
    // Arrange
    revealMock.mockResolvedValue({ ok: true })
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result } = await renderHook(() => useOpenFolder())

    // Act
    await result.current.revealInFinder('/x' as never)

    // Assert
    expect(revealMock).toHaveBeenCalledWith('/x')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('shows the failure message as an error toast when revealInFinder fails', async () => {
    // Arrange
    revealMock.mockResolvedValue({
      ok: false,
      reason: 'launch-failed',
      message: 'boom',
    })
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result } = await renderHook(() => useOpenFolder())

    // Act
    await result.current.revealInFinder('/x' as never)

    // Assert
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith('boom')
  })

  it('does not show an error toast when openInTerminal succeeds', async () => {
    // Arrange
    openTerminalMock.mockResolvedValue({ ok: true })
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result } = await renderHook(() => useOpenFolder())

    // Act
    await result.current.openInTerminal('/x' as never)

    // Assert
    expect(openTerminalMock).toHaveBeenCalledWith('/x')
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('shows the failure message as an error toast when openInTerminal fails', async () => {
    // Arrange
    openTerminalMock.mockResolvedValue({
      ok: false,
      reason: 'not-found',
      message: 'Folder not found: /missing',
    })
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result } = await renderHook(() => useOpenFolder())

    // Act
    await result.current.openInTerminal('/missing' as never)

    // Assert
    expect(toastErrorMock).toHaveBeenCalledWith('Folder not found: /missing')
  })

  it('shows a fallback error toast when revealInFinder rejects (e.g. main rethrows EPERM)', async () => {
    // The main process rethrows unexpected errors (EPERM, etc.) past the
    // structured `{ok:false}` boundary — see folder.ts. Without try/catch
    // here the user would get no feedback at all on those paths.
    // Arrange
    revealMock.mockRejectedValue(new Error('EPERM'))
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result } = await renderHook(() => useOpenFolder())

    // Act
    await result.current.revealInFinder('/locked' as never)

    // Assert
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Failed to reveal folder in Finder',
    )
  })

  it('shows a fallback error toast when openInTerminal rejects', async () => {
    // Arrange
    openTerminalMock.mockRejectedValue(new Error('EPERM'))
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result } = await renderHook(() => useOpenFolder())

    // Act
    await result.current.openInTerminal('/locked' as never)

    // Assert
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Failed to open folder in terminal',
    )
  })

  it('keeps the same callback references across re-renders so consumers do not re-run effects', async () => {
    // Arrange
    revealMock.mockResolvedValue({ ok: true })
    const { useOpenFolder } = await import('./useOpenFolder')
    const { result, rerender } = await renderHook(() => useOpenFolder())
    const firstReveal = result.current.revealInFinder
    const firstOpen = result.current.openInTerminal

    // Act
    await rerender()

    // Assert
    expect(result.current.revealInFinder).toBe(firstReveal)
    expect(result.current.openInTerminal).toBe(firstOpen)
  })
})
