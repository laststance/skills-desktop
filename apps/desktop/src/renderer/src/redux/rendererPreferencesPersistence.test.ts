import { combineReducers, configureStore } from '@reduxjs/toolkit'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  MARKDOWN_PREVIEW_MODE_KEY,
  RELEASE_NOTES_LAST_SEEN_VERSION_KEY,
  RENDERER_PREFERENCES_STORAGE_KEY,
} from '@/shared/constants'

import { createRendererPreferencesPersistence } from './rendererPreferencesPersistence'
import rendererPreferencesReducer, {
  markReleaseNotesSeen,
  setMarkdownPreviewMode,
} from './slices/rendererPreferencesSlice'

const values = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => values.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    values.set(key, value)
  }),
  removeItem: vi.fn((key: string) => {
    values.delete(key)
  }),
}

/** Boots the real middleware independently of Electron and the production singleton.
 * @example const fixture = await bootPreferences()
 */
async function bootPreferences() {
  const onFailure = vi.fn(() => true)
  const persistence = createRendererPreferencesPersistence(
    combineReducers({ rendererPreferences: rendererPreferencesReducer }),
    onFailure,
  )
  const store = configureStore({
    reducer: persistence.reducer,
    middleware: (defaults) => defaults().concat(persistence.middleware),
  })
  await persistence.api.rehydrate()
  return { store, persistence, onFailure }
}

/** Reads the public persisted envelope for assertions without consulting the running store.
 * @example expect(readPersisted()).toEqual({ version: 1, state: ... })
 */
function readPersisted() {
  return JSON.parse(values.get(RENDERER_PREFERENCES_STORAGE_KEY) ?? 'null')
}

/** Models a remote document's storage notification without writing in the receiving document.
 * @example emitStorage(target, RENDERER_PREFERENCES_STORAGE_KEY, envelope)
 */
function emitStorage(
  target: EventTarget,
  key: string | null,
  newValue: string | null,
): void {
  const event = new Event('storage')
  Object.defineProperties(event, {
    key: { value: key },
    newValue: { value: newValue },
    storageArea: { value: null },
  })
  target.dispatchEvent(event)
}

beforeEach(() => {
  values.clear()
  vi.clearAllMocks()
  localStorageMock.getItem.mockImplementation((key) => values.get(key) ?? null)
  vi.useFakeTimers()
  vi.stubGlobal('localStorage', localStorageMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  await vi.runAllTimersAsync()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('renderer preference persistence', () => {
  // Value: protects=read rejection cannot turn an unverified deletion notification into a reset; fails_when=the event guard mistakes inaccessible storage for a missing key; why_new=stale-event tests use successful storage reads; seam=none; no_claim=browser permission behavior (mocked storage)
  test('keeps the live choice when a deletion notification cannot be verified against storage', async () => {
    // Arrange
    values.set(
      RENDERER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          rendererPreferences: {
            markdownPreviewMode: 'reading',
            lastSeenVersion: '0.33.0',
          },
        },
      }),
    )
    const fixture = await bootPreferences()
    const target = new EventTarget()
    const dispose = fixture.persistence.subscribeToStorage(target as Window)
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new Error('SecurityError')
    })

    // Act
    emitStorage(target, RENDERER_PREFERENCES_STORAGE_KEY, null)
    dispose()

    // Assert
    expect(fixture.store.getState().rendererPreferences).toEqual({
      markdownPreviewMode: 'reading',
      lastSeenVersion: '0.33.0',
      hydrated: true,
    })
    expect(readPersisted().state.rendererPreferences).toEqual({
      markdownPreviewMode: 'reading',
      lastSeenVersion: '0.33.0',
    })
  })

  // Value: protects=transient read rejection cannot erase a local choice or its sibling; fails_when=denied reads are treated as remote deletion; why_new=denied startup reads do not cover a previously hydrated store; seam=none; no_claim=browser permission behavior (mocked storage)
  test('keeps a new choice and the saved release history when its edit-time read is temporarily denied', async () => {
    // Arrange
    values.set(
      RENDERER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          rendererPreferences: {
            markdownPreviewMode: 'reading',
            lastSeenVersion: '0.33.0',
          },
        },
      }),
    )
    const fixture = await bootPreferences()
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new Error('SecurityError')
    })

    // Act
    fixture.store.dispatch(setMarkdownPreviewMode('code'))

    // Assert
    expect(fixture.store.getState().rendererPreferences).toEqual({
      markdownPreviewMode: 'code',
      lastSeenVersion: '0.33.0',
      hydrated: true,
    })

    // Act
    await vi.runAllTimersAsync()

    // Assert
    expect(readPersisted().state.rendererPreferences).toEqual({
      markdownPreviewMode: 'code',
      lastSeenVersion: '0.33.0',
    })
  })

  // Value: protects=failed locked reads preserve pending edits and durable siblings until retry; fails_when=read rejection cancels dirty state as a remote clear; why_new=quota rejection occurs after the locked read and cannot cover this path; seam=none; no_claim=browser permission behavior (mocked storage)
  test('retains pending choices after a locked read failure and saves them on the next retry', async () => {
    // Arrange
    // Execute the lock callback deterministically; the native multi-window lock is covered by Electron E2E.
    vi.spyOn(navigator.locks, 'request').mockImplementation(
      async (_name, options, callback) =>
        (typeof options === 'function' ? options : callback)(null),
    )
    values.set(
      RENDERER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          rendererPreferences: {
            markdownPreviewMode: 'reading',
            lastSeenVersion: '0.33.0',
          },
        },
      }),
    )
    const fixture = await bootPreferences()
    fixture.store.dispatch(setMarkdownPreviewMode('code'))
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new Error('SecurityError')
    })

    // Act
    await vi.runAllTimersAsync()

    // Assert
    expect(fixture.store.getState().rendererPreferences).toEqual({
      markdownPreviewMode: 'code',
      lastSeenVersion: '0.33.0',
      hydrated: true,
    })
    expect(readPersisted().state.rendererPreferences).toEqual({
      markdownPreviewMode: 'reading',
      lastSeenVersion: '0.33.0',
    })
    expect(localStorageMock.setItem).not.toHaveBeenCalled()
    expect(fixture.onFailure).toHaveBeenCalledTimes(1)

    // Act
    fixture.store.dispatch({ type: 'settings/retry' })
    await vi.runAllTimersAsync()

    // Assert
    expect(readPersisted().state.rendererPreferences).toEqual({
      markdownPreviewMode: 'code',
      lastSeenVersion: '0.33.0',
    })
  })

  test('a remote clear before a queued save prevents old choices from being recreated', async () => {
    // Arrange
    const fixture = await bootPreferences()
    fixture.store.dispatch(setMarkdownPreviewMode('reading'))
    fixture.store.dispatch(markReleaseNotesSeen('0.31.0'))
    await vi.runAllTimersAsync()
    fixture.store.dispatch(markReleaseNotesSeen('0.32.0'))
    values.delete(RENDERER_PREFERENCES_STORAGE_KEY)

    // Act
    await vi.runAllTimersAsync()

    // Assert
    expect(values.has(RENDERER_PREFERENCES_STORAGE_KEY)).toBe(false)
    expect(fixture.store.getState().rendererPreferences).toEqual({
      markdownPreviewMode: 'code',
      lastSeenVersion: null,
      hydrated: true,
    })
  })

  test.each([
    {
      action: setMarkdownPreviewMode('reading'),
      expected: { markdownPreviewMode: 'reading', lastSeenVersion: null },
    },
    {
      action: markReleaseNotesSeen('0.34.0'),
      expected: { markdownPreviewMode: 'code', lastSeenVersion: '0.34.0' },
    },
  ])(
    'a new local choice after a remote clear preserves only the new intent: $expected',
    async ({ action, expected }) => {
      // Arrange
      const fixture = await bootPreferences()
      fixture.store.dispatch(setMarkdownPreviewMode('reading'))
      fixture.store.dispatch(markReleaseNotesSeen('0.31.0'))
      await vi.runAllTimersAsync()
      fixture.store.dispatch(markReleaseNotesSeen('0.32.0'))
      values.delete(RENDERER_PREFERENCES_STORAGE_KEY)

      // Act
      fixture.store.dispatch(action)
      await vi.runAllTimersAsync()

      // Assert
      expect(readPersisted().state.rendererPreferences).toEqual(expected)
    },
  )

  test('a delayed clear notification preserves a choice made after that clear', async () => {
    // Arrange
    const fixture = await bootPreferences()
    fixture.store.dispatch(markReleaseNotesSeen('0.31.0'))
    await vi.runAllTimersAsync()
    const target = new EventTarget()
    const dispose = fixture.persistence.subscribeToStorage(target as Window)
    values.delete(RENDERER_PREFERENCES_STORAGE_KEY)
    fixture.store.dispatch(setMarkdownPreviewMode('reading'))

    // Act
    emitStorage(target, RENDERER_PREFERENCES_STORAGE_KEY, null)
    await vi.runAllTimersAsync()
    dispose()

    // Assert
    expect(readPersisted().state.rendererPreferences).toEqual({
      markdownPreviewMode: 'reading',
      lastSeenVersion: null,
    })
  })

  test('preserves a remote acknowledgement saved while a local edit waits, before its storage event arrives', async () => {
    // Arrange
    values.set(
      RENDERER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          rendererPreferences: {
            markdownPreviewMode: 'code',
            lastSeenVersion: '0.31.0',
          },
        },
      }),
    )
    const fixture = await bootPreferences()
    fixture.store.dispatch(setMarkdownPreviewMode('reading'))
    fixture.store.dispatch(markReleaseNotesSeen('0.32.0'))
    // The remote save reaches storage before Chromium delivers its queued notification.
    values.set(
      RENDERER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          rendererPreferences: {
            markdownPreviewMode: 'code',
            lastSeenVersion: '0.33.0',
          },
        },
      }),
    )

    // Act
    await vi.runAllTimersAsync()

    // Assert
    expect(fixture.store.getState().rendererPreferences).toEqual({
      markdownPreviewMode: 'reading',
      lastSeenVersion: '0.33.0',
      hydrated: true,
    })
    expect(readPersisted().state.rendererPreferences).toEqual({
      markdownPreviewMode: 'reading',
      lastSeenVersion: '0.33.0',
    })
  })

  test('a delayed legacy migration preserves choices already saved by another window', async () => {
    // Arrange
    values.set(MARKDOWN_PREVIEW_MODE_KEY, 'code')
    values.set(RELEASE_NOTES_LAST_SEEN_VERSION_KEY, '0.32.0')
    const first = await bootPreferences()
    first.store.dispatch(setMarkdownPreviewMode('reading'))
    first.store.dispatch(markReleaseNotesSeen('0.33.0'))
    const second = await bootPreferences()

    // Act
    await vi.runAllTimersAsync()
    const restarted = await bootPreferences()

    // Assert
    const expected = {
      markdownPreviewMode: 'reading',
      lastSeenVersion: '0.33.0',
      hydrated: true,
    }
    expect(second.store.getState().rendererPreferences).toEqual(expected)
    expect(restarted.store.getState().rendererPreferences).toEqual(expected)
    expect(readPersisted().state.rendererPreferences).toEqual({
      markdownPreviewMode: 'reading',
      lastSeenVersion: '0.33.0',
    })
  })

  test('keeps edits in memory and warns once when the cross-window lock is rejected, then retries safely', async () => {
    // Arrange
    const fixture = await bootPreferences()
    const lockRequest = vi
      .spyOn(navigator.locks, 'request')
      .mockRejectedValue(new Error('Lock unavailable'))

    // Act
    fixture.store.dispatch(setMarkdownPreviewMode('reading'))
    await vi.runAllTimersAsync()
    fixture.store.dispatch({ type: 'settings/retry-while-locked' })
    await vi.runAllTimersAsync()

    // Assert
    expect(
      fixture.store.getState().rendererPreferences.markdownPreviewMode,
    ).toBe('reading')
    expect(fixture.onFailure).toHaveBeenCalledTimes(1)
    expect(values.has(RENDERER_PREFERENCES_STORAGE_KEY)).toBe(false)

    // Act
    lockRequest.mockRestore()
    fixture.store.dispatch({ type: 'settings/retry-after-lock-recovery' })
    await vi.runAllTimersAsync()

    // Assert
    expect(readPersisted().state.rendererPreferences.markdownPreviewMode).toBe(
      'reading',
    )
  })

  test('uses safe canonical defaults instead of resurrecting retained legacy choices when the new envelope is damaged', async () => {
    // Arrange
    values.set(MARKDOWN_PREVIEW_MODE_KEY, 'reading')
    values.set(RELEASE_NOTES_LAST_SEEN_VERSION_KEY, '0.20.0')
    values.set(RENDERER_PREFERENCES_STORAGE_KEY, 'damaged-new-envelope')

    // Act
    const fixture = await bootPreferences()

    // Assert
    expect(fixture.store.getState().rendererPreferences).toEqual({
      markdownPreviewMode: 'code',
      lastSeenVersion: null,
      hydrated: true,
    })
    expect(values.get(RENDERER_PREFERENCES_STORAGE_KEY)).toBe(
      'damaged-new-envelope',
    )
    expect(values.get(MARKDOWN_PREVIEW_MODE_KEY)).toBe('reading')
  })

  test.each([
    {
      stored: { markdownPreviewMode: 'reading', lastSeenVersion: 42 },
      expected: {
        markdownPreviewMode: 'reading',
        lastSeenVersion: null,
        hydrated: true,
      },
    },
    {
      stored: { markdownPreviewMode: 'unknown', lastSeenVersion: '0.32.0' },
      expected: {
        markdownPreviewMode: 'code',
        lastSeenVersion: '0.32.0',
        hydrated: true,
      },
    },
  ])(
    'rescues a valid preference when its sibling is malformed: $stored',
    async ({ stored, expected }) => {
      // Arrange
      values.set(
        RENDERER_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ version: 1, state: { rendererPreferences: stored } }),
      )

      // Act
      const fixture = await bootPreferences()

      // Assert
      expect(fixture.store.getState().rendererPreferences).toEqual(expected)
    },
  )

  test('ignores an older remote notification delivered after a newer local durable save', async () => {
    // Arrange
    const fixture = await bootPreferences()
    const target = new EventTarget()
    const dispose = fixture.persistence.subscribeToStorage(target as Window)
    const staleRemote = JSON.stringify({
      version: 1,
      state: {
        rendererPreferences: {
          markdownPreviewMode: 'reading',
          lastSeenVersion: null,
        },
      },
    })
    values.set(RENDERER_PREFERENCES_STORAGE_KEY, staleRemote)
    fixture.store.dispatch(setMarkdownPreviewMode('code'))
    await vi.runAllTimersAsync()

    // Act
    emitStorage(target, RENDERER_PREFERENCES_STORAGE_KEY, staleRemote)
    const restart = await bootPreferences()
    dispose()

    // Assert
    expect(
      fixture.store.getState().rendererPreferences.markdownPreviewMode,
    ).toBe('code')
    expect(
      restart.store.getState().rendererPreferences.markdownPreviewMode,
    ).toBe('code')
    expect(readPersisted().state.rendererPreferences.markdownPreviewMode).toBe(
      'code',
    )
  })

  test('imports both legacy choices without requiring an existing shared-state blob or deleting rollback keys', async () => {
    // Arrange
    values.set(MARKDOWN_PREVIEW_MODE_KEY, 'reading')
    values.set(RELEASE_NOTES_LAST_SEEN_VERSION_KEY, '0.32.0')

    // Act
    const { store } = await bootPreferences()
    await vi.runAllTimersAsync()

    // Assert
    expect(store.getState().rendererPreferences).toEqual({
      markdownPreviewMode: 'reading',
      lastSeenVersion: '0.32.0',
      hydrated: true,
    })
    expect(readPersisted()).toEqual({
      version: 1,
      state: {
        rendererPreferences: {
          markdownPreviewMode: 'reading',
          lastSeenVersion: '0.32.0',
        },
      },
    })
    expect(values.get(MARKDOWN_PREVIEW_MODE_KEY)).toBe('reading')
    expect(values.get(RELEASE_NOTES_LAST_SEEN_VERSION_KEY)).toBe('0.32.0')
    expect(localStorageMock.removeItem).not.toHaveBeenCalled()
  })

  test('prefers the middleware envelope to stale legacy choices after a restart', async () => {
    // Arrange
    values.set(MARKDOWN_PREVIEW_MODE_KEY, 'reading')
    const first = await bootPreferences()
    first.store.dispatch(setMarkdownPreviewMode('code'))
    first.store.dispatch(markReleaseNotesSeen('0.33.0'))
    await vi.runAllTimersAsync()

    // Act
    const second = await bootPreferences()

    // Assert
    expect(second.store.getState().rendererPreferences).toEqual({
      markdownPreviewMode: 'code',
      lastSeenVersion: '0.33.0',
      hydrated: true,
    })
  })

  test.each([
    'garbage',
    '{"version":1,"state":{"rendererPreferences":null}}',
    '{"version":1,"state":{"rendererPreferences":{"markdownPreviewMode":"unknown","lastSeenVersion":42}}}',
  ])(
    'opens with safe defaults and retains malformed persisted bytes: %s',
    async (raw) => {
      // Arrange
      values.set(RENDERER_PREFERENCES_STORAGE_KEY, raw)

      // Act
      const { store } = await bootPreferences()
      await vi.runAllTimersAsync()

      // Assert
      expect(store.getState().rendererPreferences).toEqual({
        markdownPreviewMode: 'code',
        lastSeenVersion: null,
        hydrated: true,
      })
      expect(values.get(RENDERER_PREFERENCES_STORAGE_KEY)).toBe(raw)
      expect(localStorageMock.removeItem).not.toHaveBeenCalled()
    },
  )

  test('keeps a user action dispatched before hydration instead of restoring an older choice', async () => {
    // Arrange
    values.set(MARKDOWN_PREVIEW_MODE_KEY, 'reading')
    const persistence = createRendererPreferencesPersistence(
      combineReducers({ rendererPreferences: rendererPreferencesReducer }),
      () => true,
    )
    const store = configureStore({
      reducer: persistence.reducer,
      middleware: (defaults) => defaults().concat(persistence.middleware),
    })

    // Act
    store.dispatch(setMarkdownPreviewMode('code'))
    await persistence.api.rehydrate()
    await vi.runAllTimersAsync()

    // Assert
    expect(store.getState().rendererPreferences.markdownPreviewMode).toBe(
      'code',
    )
    expect(readPersisted().state.rendererPreferences.markdownPreviewMode).toBe(
      'code',
    )
  })

  test('preserves different fields when two windows save from stale Redux snapshots', async () => {
    // Arrange
    const main = await bootPreferences()
    const settings = await bootPreferences()

    // Act
    main.store.dispatch(setMarkdownPreviewMode('reading'))
    await vi.runAllTimersAsync()
    settings.store.dispatch(markReleaseNotesSeen('0.33.0'))
    await vi.runAllTimersAsync()
    settings.store.dispatch({ type: 'settings/unrelated-edit' })
    await vi.runAllTimersAsync()
    const restart = await bootPreferences()

    // Assert
    expect(readPersisted()).toEqual({
      version: 1,
      state: {
        rendererPreferences: {
          markdownPreviewMode: 'reading',
          lastSeenVersion: '0.33.0',
        },
      },
    })
    expect(restart.store.getState().rendererPreferences).toEqual({
      markdownPreviewMode: 'reading',
      lastSeenVersion: '0.33.0',
      hydrated: true,
    })
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(2)
  })

  test('adopts a remote mode while retaining an unrelated unsaved release acknowledgement and never echoes unchanged events', async () => {
    // Arrange
    const fixture = await bootPreferences()
    const target = new EventTarget()
    const dispose = fixture.persistence.subscribeToStorage(target as Window)
    fixture.store.dispatch(markReleaseNotesSeen('0.33.0'))
    const remote = JSON.stringify({
      version: 1,
      state: {
        rendererPreferences: {
          markdownPreviewMode: 'reading',
          lastSeenVersion: null,
        },
      },
    })
    values.set(RENDERER_PREFERENCES_STORAGE_KEY, remote)

    // Act
    emitStorage(target, RENDERER_PREFERENCES_STORAGE_KEY, remote)
    await vi.runAllTimersAsync()
    const saved = values.get(RENDERER_PREFERENCES_STORAGE_KEY) ?? null
    emitStorage(target, RENDERER_PREFERENCES_STORAGE_KEY, saved)
    await vi.runAllTimersAsync()
    dispose()

    // Assert
    expect(fixture.store.getState().rendererPreferences).toEqual({
      markdownPreviewMode: 'reading',
      lastSeenVersion: '0.33.0',
      hydrated: true,
    })
    expect(readPersisted().state.rendererPreferences).toEqual({
      markdownPreviewMode: 'reading',
      lastSeenVersion: '0.33.0',
    })
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1)
  })

  test('lets a changed remote field supersede a queued local choice without resurrecting it on a later action', async () => {
    // Arrange
    values.set(MARKDOWN_PREVIEW_MODE_KEY, 'reading')
    const fixture = await bootPreferences()
    await vi.runAllTimersAsync()
    const target = new EventTarget()
    const dispose = fixture.persistence.subscribeToStorage(target as Window)
    fixture.store.dispatch(setMarkdownPreviewMode('reading'))
    const remote = JSON.stringify({
      version: 1,
      state: {
        rendererPreferences: {
          markdownPreviewMode: 'code',
          lastSeenVersion: null,
        },
      },
    })
    values.set(RENDERER_PREFERENCES_STORAGE_KEY, remote)

    // Act
    emitStorage(target, RENDERER_PREFERENCES_STORAGE_KEY, remote)
    fixture.store.dispatch({ type: 'settings/unrelated-edit' })
    await vi.runAllTimersAsync()
    dispose()

    // Assert
    expect(
      fixture.store.getState().rendererPreferences.markdownPreviewMode,
    ).toBe('code')
    expect(readPersisted().state.rendererPreferences.markdownPreviewMode).toBe(
      'code',
    )
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1)
  })

  test('ignores unrelated and malformed storage events, then resets live preferences after a remote clear', async () => {
    // Arrange
    const fixture = await bootPreferences()
    fixture.store.dispatch(setMarkdownPreviewMode('reading'))
    await vi.runAllTimersAsync()
    const target = new EventTarget()
    const dispose = fixture.persistence.subscribeToStorage(target as Window)

    // Act
    emitStorage(target, 'other-key', null)
    values.set(RENDERER_PREFERENCES_STORAGE_KEY, 'not-json')
    emitStorage(target, RENDERER_PREFERENCES_STORAGE_KEY, 'not-json')

    // Assert
    expect(
      fixture.store.getState().rendererPreferences.markdownPreviewMode,
    ).toBe('reading')

    // Act
    values.clear()
    emitStorage(target, null, null)
    await vi.runAllTimersAsync()
    dispose()

    // Assert
    expect(fixture.store.getState().rendererPreferences).toEqual({
      markdownPreviewMode: 'code',
      lastSeenVersion: null,
      hydrated: true,
    })
    expect(values.size).toBe(0)
  })

  test('retains legacy data and the session choice after quota failure, then retries the pending write', async () => {
    // Arrange
    values.set(MARKDOWN_PREVIEW_MODE_KEY, 'reading')
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError')
    })
    const fixture = await bootPreferences()

    // Act
    await vi.runAllTimersAsync()

    // Assert
    expect(
      fixture.store.getState().rendererPreferences.markdownPreviewMode,
    ).toBe('reading')
    expect(fixture.onFailure).toHaveBeenCalledTimes(1)
    expect(values.get(MARKDOWN_PREVIEW_MODE_KEY)).toBe('reading')
    expect(values.has(RENDERER_PREFERENCES_STORAGE_KEY)).toBe(false)

    // Act
    fixture.store.dispatch({ type: 'settings/retry' })
    await vi.runAllTimersAsync()

    // Assert
    expect(readPersisted().state.rendererPreferences.markdownPreviewMode).toBe(
      'reading',
    )
  })

  test('finishes startup with defaults even when all storage reads are denied', async () => {
    // Arrange
    localStorageMock.getItem.mockImplementation(() => {
      throw new Error('SecurityError')
    })

    // Act
    const fixture = await bootPreferences()

    // Assert
    expect(fixture.store.getState().rendererPreferences).toEqual({
      markdownPreviewMode: 'code',
      lastSeenVersion: null,
      hydrated: true,
    })
  })
})
