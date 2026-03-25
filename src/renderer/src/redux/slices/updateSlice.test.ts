import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it } from 'vitest'

async function createTestStore() {
  const { default: updateReducer } = await import('./updateSlice')
  return configureStore({ reducer: { update: updateReducer } })
}

describe('updateSlice', () => {
  it('has correct initial state', async () => {
    const store = await createTestStore()
    const state = store.getState().update
    expect(state.status).toBe('idle')
    expect(state.version).toBeNull()
    expect(state.releaseNotes).toBeNull()
    expect(state.progress).toBe(0)
    expect(state.error).toBeNull()
    expect(state.dismissed).toBe(false)
  })

  it('setChecking sets status and clears error', async () => {
    const { setChecking, setError } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(setError('previous error'))
    store.dispatch(setChecking())

    const state = store.getState().update
    expect(state.status).toBe('checking')
    expect(state.error).toBeNull()
  })

  it('setAvailable stores version and release notes', async () => {
    const { setAvailable } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(
      setAvailable({ version: '1.2.0', releaseNotes: 'Bug fixes' }),
    )

    const state = store.getState().update
    expect(state.status).toBe('available')
    expect(state.version).toBe('1.2.0')
    expect(state.releaseNotes).toBe('Bug fixes')
    expect(state.dismissed).toBe(false)
  })

  it('setAvailable handles missing releaseNotes', async () => {
    const { setAvailable } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(setAvailable({ version: '1.2.0' }))

    expect(store.getState().update.releaseNotes).toBeNull()
  })

  it('setAvailable resets dismissed flag', async () => {
    const { setAvailable, dismiss } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(dismiss())
    expect(store.getState().update.dismissed).toBe(true)

    store.dispatch(setAvailable({ version: '1.3.0' }))
    expect(store.getState().update.dismissed).toBe(false)
  })

  it('setNotAvailable resets status to idle', async () => {
    const { setChecking, setNotAvailable } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(setChecking())
    store.dispatch(setNotAvailable())

    expect(store.getState().update.status).toBe('idle')
  })

  it('setDownloading sets status', async () => {
    const { setDownloading } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(setDownloading())
    expect(store.getState().update.status).toBe('downloading')
  })

  it('setProgress updates status and percent', async () => {
    const { setProgress } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(
      setProgress({
        percent: 42,
        bytesPerSecond: 1024,
        total: 10000,
        transferred: 4200,
      }),
    )

    const state = store.getState().update
    expect(state.status).toBe('downloading')
    expect(state.progress).toBe(42)
  })

  it('setReady sets version, notes, and progress to 100', async () => {
    const { setReady } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(setReady({ version: '2.0.0', releaseNotes: 'Major update' }))

    const state = store.getState().update
    expect(state.status).toBe('ready')
    expect(state.version).toBe('2.0.0')
    expect(state.releaseNotes).toBe('Major update')
    expect(state.progress).toBe(100)
  })

  it('setError stores error message', async () => {
    const { setError } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(setError('Download failed'))

    const state = store.getState().update
    expect(state.status).toBe('error')
    expect(state.error).toBe('Download failed')
  })

  it('dismiss sets dismissed flag', async () => {
    const { dismiss } = await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(dismiss())
    expect(store.getState().update.dismissed).toBe(true)
  })

  it('reset returns to initial state', async () => {
    const { setAvailable, setDownloading, setProgress, reset } =
      await import('./updateSlice')
    const store = await createTestStore()
    store.dispatch(setAvailable({ version: '1.0.0', releaseNotes: 'notes' }))
    store.dispatch(setDownloading())
    store.dispatch(
      setProgress({
        percent: 50,
        bytesPerSecond: 2048,
        total: 10000,
        transferred: 5000,
      }),
    )

    store.dispatch(reset())
    const state = store.getState().update
    expect(state.status).toBe('idle')
    expect(state.version).toBeNull()
    expect(state.progress).toBe(0)
  })
})
