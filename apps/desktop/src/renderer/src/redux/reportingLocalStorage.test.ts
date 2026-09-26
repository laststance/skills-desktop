import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { createReportingLocalStorage } from './reportingLocalStorage'

/**
 * Guards the only signal a user gets that their locked skills, bookmarks and
 * theme have stopped persisting. The library's own adapter swallows a rejected
 * write into a console line, so a regression here restores the exact silence
 * this adapter exists to break.
 */
describe('createReportingLocalStorage', () => {
  beforeEach(() => {
    // The adapter console.errors every rejected write; silence it so a failing
    // assertion is not buried under expected noise.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('warns the user once no matter how many debounced saves localStorage rejects', () => {
    // Arrange
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
      removeItem: () => {},
    })
    const onWriteFailure = vi.fn(() => true)
    const storage = createReportingLocalStorage(onWriteFailure)

    // Act
    storage.setItem('skills-desktop-state', '{"protect":{"items":["a"]}}')
    storage.setItem('skills-desktop-state', '{"protect":{"items":["a","b"]}}')
    storage.setItem('skills-desktop-state', '{"protect":{"items":[]}}')

    // Assert
    expect(onWriteFailure).toHaveBeenCalledTimes(1)
  })

  test('stays silent while localStorage accepts the persisted state', () => {
    // Arrange
    const written: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => written[key] ?? null,
      setItem: (key: string, value: string) => {
        written[key] = value
      },
      removeItem: () => {},
    })
    const onWriteFailure = vi.fn(() => true)
    const storage = createReportingLocalStorage(onWriteFailure)

    // Act
    storage.setItem('skills-desktop-state', '{"theme":{"mode":"dark"}}')

    // Assert
    expect(written['skills-desktop-state']).toBe('{"theme":{"mode":"dark"}}')
    expect(onWriteFailure).toHaveBeenCalledTimes(0)
  })

  test('boots from initial state instead of throwing when localStorage cannot be read', () => {
    // Arrange
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError: storage is disabled')
      },
      setItem: () => {},
      removeItem: () => {},
    })
    const onWriteFailure = vi.fn(() => true)
    const storage = createReportingLocalStorage(onWriteFailure)

    // Act
    const loaded = storage.getItem('skills-desktop-state')

    // Assert
    expect(loaded).toBe(null)
    expect(onWriteFailure).toHaveBeenCalledTimes(0)
  })

  test('does not warn about lost data when clearing persisted state fails', () => {
    // Arrange
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new Error('SecurityError: storage is disabled')
      },
    })
    const onWriteFailure = vi.fn(() => true)
    const storage = createReportingLocalStorage(onWriteFailure)

    // Act
    storage.removeItem('skills-desktop-state')

    // Assert
    expect(onWriteFailure).toHaveBeenCalledTimes(0)
  })

  test('keeps the warning unspent when the hydration write fails before any toast surface exists', () => {
    // Arrange — the middleware writes once, undebounced, during hydration; a
    // warning published then reaches nobody, so the adapter must try again.
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
      removeItem: () => {},
    })
    const onWriteFailure = vi
      .fn<(error: unknown) => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
    const storage = createReportingLocalStorage(onWriteFailure)

    // Act — the hydration migration write, then the first debounced save.
    storage.setItem('skills-desktop-state', '{"theme":{"mode":"dark"}}')
    storage.setItem('skills-desktop-state', '{"protect":{"items":["a"]}}')
    storage.setItem('skills-desktop-state', '{"protect":{"items":["a","b"]}}')

    // Assert — retried after the undelivered attempt, then latched.
    expect(onWriteFailure).toHaveBeenCalledTimes(2)
  })

  test('warns again in a fresh app run after the previous run already warned', () => {
    // Arrange
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
      removeItem: () => {},
    })
    const firstRun = vi.fn(() => true)
    const secondRun = vi.fn(() => true)

    // Act
    createReportingLocalStorage(firstRun).setItem('skills-desktop-state', '{}')
    createReportingLocalStorage(secondRun).setItem('skills-desktop-state', '{}')

    // Assert
    expect(firstRun).toHaveBeenCalledTimes(1)
    expect(secondRun).toHaveBeenCalledTimes(1)
  })
})
