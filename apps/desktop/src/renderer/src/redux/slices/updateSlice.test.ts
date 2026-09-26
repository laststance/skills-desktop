import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, test } from 'vitest'

import {
  semanticVersion,
  toByteCount,
  toBytesPerSecond,
  toProgressPercent,
} from '@/shared/types'

async function createTestStore() {
  const { default: updateReducer } = await import('./updateSlice')
  return configureStore({ reducer: { update: updateReducer } })
}

describe('updateSlice', () => {
  test('starts idle with no pending update and nothing dismissed', async () => {
    // Arrange
    const store = await createTestStore()

    // Act
    const state = store.getState().update

    // Assert
    expect(state.status).toBe('idle')
    expect(state.version).toBeNull()
    expect(state.releaseNotes).toBeNull()
    expect(state.progress).toBe(0)
    expect(state.error).toBeNull()
    expect(state.dismissed).toBe(false)
  })

  test('clears a prior error when a fresh update check begins', async () => {
    // Arrange
    const { setChecking, setError } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(setError('previous error'))

    // Act
    store.dispatch(setChecking())

    // Assert
    const state = store.getState().update
    expect(state.status).toBe('checking')
    expect(state.error).toBeNull()
  })

  test('announces an available update with its version and release notes', async () => {
    // Arrange
    const { setAvailable } = await import('./updateSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(
      setAvailable({
        version: semanticVersion('1.2.0'),
        releaseNotes: 'Bug fixes',
      }),
    )

    // Assert
    const state = store.getState().update
    expect(state.status).toBe('available')
    expect(state.version).toBe('1.2.0')
    expect(state.releaseNotes).toBe('Bug fixes')
    expect(state.dismissed).toBe(false)
  })

  test('leaves release notes empty when an available update omits them', async () => {
    // Arrange
    const { setAvailable } = await import('./updateSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(setAvailable({ version: semanticVersion('1.2.0') }))

    // Assert
    expect(store.getState().update.releaseNotes).toBeNull()
  })

  test('re-surfaces a previously dismissed banner when a new update arrives', async () => {
    // Arrange
    const { setAvailable, dismiss } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(dismiss())
    expect(store.getState().update.dismissed).toBe(true)

    // Act
    store.dispatch(setAvailable({ version: semanticVersion('1.3.0') }))

    // Assert
    expect(store.getState().update.dismissed).toBe(false)
  })

  test('returns to idle when the check finds no update available', async () => {
    // Arrange
    const { setChecking, setNotAvailable } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(setChecking())

    // Act
    store.dispatch(setNotAvailable())

    // Assert
    expect(store.getState().update.status).toBe('idle')
  })

  test('shows a downloading state once the update download starts', async () => {
    // Arrange
    const { setDownloading } = await import('./updateSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(setDownloading())

    // Assert
    expect(store.getState().update.status).toBe('downloading')
  })

  test('reflects download progress as a percentage while downloading', async () => {
    // Arrange
    const { setProgress } = await import('./updateSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(
      setProgress({
        percent: toProgressPercent(42),
        bytesPerSecond: toBytesPerSecond(1024),
        total: toByteCount(10000),
        transferred: toByteCount(4200),
      }),
    )

    // Assert
    const state = store.getState().update
    expect(state.status).toBe('downloading')
    expect(state.progress).toBe(42)
  })

  test('marks the update ready to install with full progress and release details', async () => {
    // Arrange
    const { setReady } = await import('./updateSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(
      setReady({
        version: semanticVersion('2.0.0'),
        releaseNotes: 'Major update',
      }),
    )

    // Assert
    const state = store.getState().update
    expect(state.status).toBe('ready')
    expect(state.version).toBe('2.0.0')
    expect(state.releaseNotes).toBe('Major update')
    expect(state.progress).toBe(100)
  })

  test('leaves release notes empty when a ready update omits them', async () => {
    // Arrange
    const { setReady } = await import('./updateSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(setReady({ version: semanticVersion('2.0.0') }))

    // Assert
    expect(store.getState().update.releaseNotes).toBeNull()
  })

  test('surfaces the failure message when the update flow errors', async () => {
    // Arrange
    const { setError } = await import('./updateSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(setError('Download failed'))

    // Assert
    const state = store.getState().update
    expect(state.status).toBe('error')
    expect(state.error).toBe('Download failed')
  })

  test('hides the update banner when the user dismisses it', async () => {
    // Arrange
    const { dismiss } = await import('./updateSlice')
    const store = await createTestStore()

    // Act
    store.dispatch(dismiss())

    // Assert
    expect(store.getState().update.dismissed).toBe(true)
  })

  test('clears an in-progress update back to the idle starting point', async () => {
    // Arrange
    const { setAvailable, setDownloading, setProgress, reset } =
      await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(
      setAvailable({
        version: semanticVersion('1.0.0'),
        releaseNotes: 'notes',
      }),
    )
    store.dispatch(setDownloading())
    store.dispatch(
      setProgress({
        percent: toProgressPercent(50),
        bytesPerSecond: toBytesPerSecond(2048),
        total: toByteCount(10000),
        transferred: toByteCount(5000),
      }),
    )

    // Act
    store.dispatch(reset())

    // Assert
    const state = store.getState().update
    expect(state.status).toBe('idle')
    expect(state.version).toBeNull()
    expect(state.progress).toBe(0)
  })
})
